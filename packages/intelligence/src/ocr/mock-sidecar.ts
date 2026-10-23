// The mock OCR for tests and fixtures: an `<file>.ocr.json` sidecar next to a synthetic scan holds
// the text each page "reads" as, so the pipeline runs without a provider.
import { readFileSync } from 'node:fs';

import type { OcrLine } from './line-boxes.ts';
import type { OcrPageInput, OcrPageResult, OcrPort } from './ocr.ts';

export interface OcrSidecar {
  pages: { page: number; text: string; confidence?: number; lines?: OcrLine[] }[];
}

/** The sidecar of `file` (`<file>.ocr.json`). */
export function readSidecar(file: string): OcrSidecar {
  return JSON.parse(readFileSync(`${file}.ocr.json`, 'utf8')) as OcrSidecar;
}

export interface SidecarOcr extends OcrPort {
  /** Page numbers OCRed so far, in call order. */
  readonly calls: number[];
}

/** An OCR port that answers from `sidecar`; a page it does not list reads as empty, confidence 0. */
export function createSidecarOcr(sidecar: OcrSidecar, defaultConfidence = 0.9): SidecarOcr {
  const calls: number[] = [];
  return {
    calls,
    ocrPage({ pageNo }: OcrPageInput): Promise<OcrPageResult> {
      calls.push(pageNo);
      const page = sidecar.pages.find((p) => p.page === pageNo);
      return Promise.resolve(
        page === undefined
          ? { text: '', confidence: 0 }
          : {
              text: page.text,
              confidence: page.confidence ?? defaultConfidence,
              ...(page.lines === undefined ? {} : { lines: page.lines }),
            },
      );
    },
  };
}
