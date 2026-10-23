// The document pipeline (#45; PRD DI-1, DI-2, CA-3, CA-4):
//   sniff -> text layer -> coverage check -> OCR (gateway) for weak pages -> language -> classify
//   -> render -> persist -> emit.
// Text layer first, OCR only for pages the layer cannot cover, deterministic classification before
// any model. Unreadable input is never guessed: it becomes a "Needs you" outcome with a reason and
// the raw file stays as the capture's L1 object. A sensitive matter or `ai_blocked` capture skips
// every AI step. The pipeline calls no other module: results leave through `IntelligenceEvents`,
// storage and the database through the `Persister`, model calls through the OCR and classifier
// ports (the gateway in production).
import { BudgetExceededError, SensitiveMatterBlockedError } from '@causedeck/ai';
import type { Queryable } from '@causedeck/db';
import type { DocumentKind, DocumentTextStatus } from '@causedeck/db/schema';
import type { CaptureNeedsYouReason } from '@causedeck/validators';

import { classifyDocument, type LlmClassifier } from '../classify/index.ts';
import { noEvents, type IntelligenceEvents } from '../events.ts';
import { detectDocumentLanguage, type LanguageTag } from '../language/detect.ts';
import { runOcr, type OcrLanguage, type OcrPort } from '../ocr/ocr.ts';
import type { ExistingDocument, PersistPage, Persister, PersistResult } from '../persist.ts';
import type { OpenedDocument, PageRenderer } from '../render/renderer.ts';
import { makePageImages, THUMBNAIL_DPI, type PageImages } from '../render/thumbs.ts';
import { DocxReadError, readDocxText } from '../text/docx-text.ts';
import { PdfReadError, readPdfText } from '../text/pdf-text.ts';
import { readPlainText } from '../text/plain.ts';
import {
  assemblePages,
  lowConfidencePages,
  needsYouReason,
  renderMime,
  simhash,
  sniffFormat,
  textStatusOf,
  weakPages,
  type InputFormat,
  type SkipReason,
} from './steps.ts';
import { DEFAULT_PIPELINE_OPTIONS, PIPELINE_VERSION, type PipelineOptions } from './version.ts';

export interface PipelineInput {
  workspaceId: string;
  captureId: string;
  matterId?: string | null;
  userId?: string | null;
  bytes: Uint8Array;
  mime: string;
  sha256: string;
  /** The capture's raw object key; kept untouched (L1). */
  rawStorageKey: string;
  /** The capture is `ai_blocked` (sensitive matter hint): no OCR or model call, ever. */
  aiBlocked: boolean;
  /** `en`, `ta` or `kn` from the forum or the capture's meta. */
  languageHint?: OcrLanguage | null;
  pipelineVersion?: string;
}

export interface FinishedOutcome {
  status: 'ready' | 'needs_you';
  reason: CaptureNeedsYouReason | null;
  /** `null` when nothing could be read at all (corrupt, password protected, unsupported). */
  documentId: string | null;
  kind: DocumentKind | null;
  language: string | null;
  textStatus: DocumentTextStatus | null;
  lowConfidencePages: number[];
  skippedReason: SkipReason | null;
  /** False when a document for this `(capture, pipelineVersion)` already existed. */
  created: boolean;
}

/** OCR needed AI and the workspace's AI is paused or over budget: the capture waits. */
export interface DeferredOutcome {
  status: 'deferred';
  reason: 'ai_paused';
  /** The text-layer document kept meanwhile (`text_status = 'pending'`). */
  documentId: string | null;
}

export type PipelineOutcome = FinishedOutcome | DeferredOutcome;

/** Called inside the persisting transaction, so the capture moves on in the same commit. */
export type PersistedHook = (tx: Queryable, outcome: FinishedOutcome) => Promise<void>;

export interface PipelineDeps {
  ocr: OcrPort;
  /** The model classifier; the pipeline never calls it for an `ai_blocked` capture. */
  llm: LlmClassifier | null;
  renderer: PageRenderer;
  persister: Persister;
  events?: IntelligenceEvents;
  options?: Partial<PipelineOptions>;
  onPersisted?: PersistedHook;
}

class PageRenderError extends Error {
  override name = 'PageRenderError';
}

function failure(reason: CaptureNeedsYouReason): FinishedOutcome {
  return {
    status: 'needs_you',
    reason,
    documentId: null,
    kind: null,
    language: null,
    textStatus: null,
    lowConfidencePages: [],
    skippedReason: null,
    created: false,
  };
}

function fromExisting(existing: ExistingDocument): FinishedOutcome {
  const reason: CaptureNeedsYouReason | null =
    existing.lowConfidencePages.length > 0 || !existing.hasText ? 'unreadable' : null;
  return {
    status: reason === null ? 'ready' : 'needs_you',
    reason,
    documentId: existing.documentId,
    kind: existing.kind,
    language: existing.language,
    textStatus: existing.textStatus,
    lowConfidencePages: existing.lowConfidencePages,
    skippedReason: null,
    created: false,
  };
}

async function readLayer(
  format: InputFormat,
  bytes: Uint8Array,
): Promise<{ pageNo: number; text: string }[]> {
  if (format === 'pdf') return readPdfText(bytes);
  if (format === 'docx') return [{ pageNo: 1, text: await readDocxText(bytes) }];
  if (format === 'text') {
    return readPlainText(bytes).map((text, i) => ({ pageNo: i + 1, text }));
  }
  return [{ pageNo: 1, text: '' }];
}

/** Lazy page rendering: opens the document once, caches the page images, hands out PNGs for OCR. */
function createPageSource(renderer: PageRenderer, bytes: Uint8Array, mime: string) {
  let opened: Promise<OpenedDocument | null> | null = null;
  const open = (): Promise<OpenedDocument | null> =>
    (opened ??= renderer.open(bytes, mime).catch(() => null));
  const images = new Map<number, PageImages | null>();

  async function render(pageNo: number): Promise<{ png: Uint8Array; images: PageImages } | null> {
    const doc = await open();
    if (doc === null) return null;
    try {
      const page = await doc.renderPage(pageNo, THUMBNAIL_DPI);
      const made = await makePageImages(page.png);
      images.set(pageNo, made);
      return { png: page.png, images: made };
    } catch {
      images.set(pageNo, null);
      return null;
    }
  }

  return {
    async png(pageNo: number): Promise<Uint8Array> {
      const page = await render(pageNo);
      if (page === null) throw new PageRenderError(`page ${String(pageNo)} could not be rendered`);
      return page.png;
    },
    async imagesFor(pageNo: number): Promise<PageImages | null> {
      const cached = images.get(pageNo);
      if (cached !== undefined) return cached;
      return (await render(pageNo))?.images ?? null;
    },
    async close(): Promise<void> {
      const doc = await (opened ?? Promise.resolve(null));
      doc?.close();
    },
  };
}

export async function processCapture(
  deps: PipelineDeps,
  input: PipelineInput,
): Promise<PipelineOutcome> {
  const options = { ...DEFAULT_PIPELINE_OPTIONS, ...deps.options };
  const events = deps.events ?? noEvents;
  const pipelineVersion = input.pipelineVersion ?? PIPELINE_VERSION;
  const languageHint = input.languageHint ?? null;

  // Idempotent per (capture, pipelineVersion): a finished document is returned, never rebuilt.
  const existing = await deps.persister.findExisting(
    input.workspaceId,
    input.captureId,
    pipelineVersion,
  );
  if (existing !== null && existing.textStatus !== 'pending') return fromExisting(existing);

  const format = sniffFormat(input.bytes, input.mime);
  if (format === 'unsupported') return failure('unreadable');

  let layer: { pageNo: number; text: string }[];
  try {
    layer = await readLayer(format, input.bytes);
  } catch (error) {
    if (error instanceof PdfReadError) return failure(error.reason);
    if (error instanceof DocxReadError) return failure('corrupt');
    throw error;
  }

  const rendered = format === 'pdf' || format === 'image';
  const source = createPageSource(deps.renderer, input.bytes, renderMime(input.bytes, format));
  try {
    const weak = rendered
      ? weakPages(layer, { minPageChars: options.minPageChars, languageHint })
      : [];

    let skipReason: SkipReason | null = input.aiBlocked ? 'ai_blocked' : null;
    let ocrRan = false;
    let ocrResults = new Map<number, { text: string; confidence: number }>();
    let deferred = false;
    if (weak.length > 0 && skipReason === null) {
      try {
        ocrResults = await runOcr(deps.ocr, weak, (pageNo) => source.png(pageNo), {
          batchSize: options.ocrBatchSize,
          language: languageHint ?? undefined,
        });
        ocrRan = true;
      } catch (error) {
        if (error instanceof BudgetExceededError) deferred = true;
        else if (error instanceof SensitiveMatterBlockedError) skipReason = 'sensitive_matter';
        else if (!(error instanceof PageRenderError)) throw error;
      }
    }

    const pages = assemblePages(layer, ocrResults, { languageHint });
    const fullText = pages.map((page) => page.text).join('\n\n');
    const tag: LanguageTag | null = detectDocumentLanguage(pages.map((page) => page.text));
    const language = tag ?? languageHint;
    const aiAllowed = !input.aiBlocked && skipReason === null && !deferred;
    const classification = await classifyDocument(
      pages
        .slice(0, 3)
        .map((page) => page.text)
        .join('\n\n'),
      { llm: aiAllowed ? deps.llm : null, pageCount: pages.length },
    );

    const base = {
      workspaceId: input.workspaceId,
      captureId: input.captureId,
      rawStorageKey: input.rawStorageKey,
      sha256: input.sha256,
      pipelineVersion,
      kind: classification.kind,
      classificationConfidence: classification.confidence,
      language,
      skippedReason: skipReason,
      simhash: simhash(fullText),
      nearDuplicateDistance: options.nearDuplicateDistance,
    };

    if (deferred) {
      // AI is paused: keep the text layer as a pending document and leave the capture queued.
      const result = await deps.persister.persist({
        ...base,
        textStatus: 'pending',
        lowConfidencePages: [],
        pages: pages.map((page): PersistPage => ({ ...page, images: null })),
      });
      return { status: 'deferred', reason: 'ai_paused', documentId: result.documentId };
    }

    const lowConfidence = lowConfidencePages(pages, options.confidenceFloor);
    const textStatus = textStatusOf({ pages, weak, ocrRan, skipReason });
    const reason = needsYouReason({ pages, lowConfidence });
    const persistPages: PersistPage[] = [];
    for (const page of pages) {
      persistPages.push({ ...page, images: rendered ? await source.imagesFor(page.pageNo) : null });
    }

    const finished = (result: PersistResult): FinishedOutcome => ({
      status: reason === null ? 'ready' : 'needs_you',
      reason,
      documentId: result.documentId,
      kind: classification.kind,
      language,
      textStatus,
      lowConfidencePages: lowConfidence,
      skippedReason: skipReason,
      created: result.created,
    });
    const result = await deps.persister.persist(
      { ...base, textStatus, lowConfidencePages: lowConfidence, pages: persistPages },
      deps.onPersisted === undefined
        ? undefined
        : (tx, persisted) => deps.onPersisted?.(tx, finished(persisted)) ?? Promise.resolve(),
    );

    if (result.created) {
      await emitAll(events, [
        {
          type: 'document.processed',
          workspaceId: input.workspaceId,
          captureId: input.captureId,
          documentId: result.documentId,
          kind: classification.kind,
          language,
          textStatus,
        },
        {
          type: 'capture.classified',
          workspaceId: input.workspaceId,
          captureId: input.captureId,
          documentId: result.documentId,
          kind: classification.kind,
          confidence: classification.confidence,
          aiBlocked: input.aiBlocked,
        },
        ...(result.nearDuplicateOf === null
          ? []
          : [
              {
                type: 'document.near_duplicate' as const,
                workspaceId: input.workspaceId,
                documentId: result.documentId,
                ofDocumentId: result.nearDuplicateOf,
              },
            ]),
      ]);
    }
    return finished(result);
  } finally {
    await source.close();
  }
}

/** Events leave after the commit; a failing subscriber never undoes the document. */
async function emitAll(
  events: IntelligenceEvents,
  list: Parameters<IntelligenceEvents['emit']>[0][],
): Promise<void> {
  for (const event of list) {
    try {
      await events.emit(event);
    } catch {
      // Subscribers are best effort: the document is already stored.
    }
  }
}
