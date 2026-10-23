// OCR fallback (DI-1): only pages the text layer could not cover go to the gateway `ocr` task, one
// page image per call so a retry reuses stored results (idempotency key per page) and the budget
// is reserved per call. The gateway decides India-only routing, budgets and audit; the pipeline
// only passes the language hint (en/ta/kn).
import type { AiGateway, RunContext } from '@causedeck/ai';

export type OcrLanguage = 'en' | 'ta' | 'kn';

export interface OcrPageInput {
  pageNo: number;
  png: Uint8Array;
  language?: OcrLanguage | undefined;
}

export interface OcrPageResult {
  text: string;
  /** 0-1. */
  confidence: number;
}

/** Reads one page image. The gateway-backed port is the product; tests use the sidecar port. */
export interface OcrPort {
  ocrPage(input: OcrPageInput): Promise<OcrPageResult>;
}

export interface GatewayOcrOptions {
  gateway: AiGateway;
  /** Workspace, capture, matter and user the calls are charged and audited to. */
  scope: Pick<RunContext, 'workspaceId' | 'captureId' | 'matterId' | 'userId'>;
  pipelineVersion: string;
}

interface OcrOutput {
  pages: { page: number; text: string; confidence?: number | undefined }[];
  confidence: number;
}

export function createGatewayOcr(options: GatewayOcrOptions): OcrPort {
  const { gateway, scope, pipelineVersion } = options;
  return {
    async ocrPage({ pageNo, png, language }) {
      const result = await gateway.run<OcrOutput>(
        'ocr',
        {
          contentBase64: Buffer.from(png).toString('base64'),
          mimeType: 'image/png',
          pageCount: 1,
          ...(language === undefined ? {} : { language }),
        },
        {
          ...scope,
          purpose: 'capture.ocr',
          idempotencyKey: `capture-ocr:${scope.captureId ?? 'none'}:${pipelineVersion}:${String(pageNo)}`,
        },
      );
      const [page] = result.output.pages;
      return {
        text: page?.text ?? '',
        confidence: page?.confidence ?? result.output.confidence,
      };
    },
  };
}

export interface OcrRunOptions {
  /** Pages OCRed at the same time. */
  batchSize?: number;
  language?: OcrLanguage | undefined;
}

export const DEFAULT_OCR_BATCH = 4;

/** OCR the given pages in batches; the first failure (budget, provider) rejects the whole run. */
export async function runOcr(
  port: OcrPort,
  pageNos: readonly number[],
  getPng: (pageNo: number) => Promise<Uint8Array>,
  options: OcrRunOptions = {},
): Promise<Map<number, OcrPageResult>> {
  const size = Math.max(1, options.batchSize ?? DEFAULT_OCR_BATCH);
  const results = new Map<number, OcrPageResult>();
  for (let start = 0; start < pageNos.length; start += size) {
    const batch = pageNos.slice(start, start + size);
    const done = await Promise.all(
      batch.map(async (pageNo) => {
        const png = await getPng(pageNo);
        return [pageNo, await port.ocrPage({ pageNo, png, language: options.language })] as const;
      }),
    );
    for (const [pageNo, result] of done) results.set(pageNo, result);
  }
  return results;
}
