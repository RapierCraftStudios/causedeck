// Drains `corpus_ocr_queue` (#1030): the judgment pages the bulk importer found without a usable
// text layer (#890). A batch is claimed in one statement (`for update skip locked`, with a lease in
// `next_attempt_at` so a crashed worker's pages come back), each page is rendered from the stored
// PDF and read by the gateway OCR port, and the text is written into `judgment.page_text` with
// `source: 'ocr'` in the same transaction that deletes the queue row. A failing page is retried with
// exponential backoff and parked with its error code after `maxAttempts`; a row is never deleted
// without its text being stored. Only ids, counts and error codes are logged or stored.
import { schema, type Queryable } from '@causedeck/db';
import { eq, sql } from 'drizzle-orm';

import type { OcrPort } from '../ocr/ocr.ts';
import type { PageRenderer } from '../render/renderer.ts';

import { corpusBlobKey } from './ingest.ts';

const { corpusOcrQueue, judgment } = schema;

export const OCR_DPI = 200;
export const OCR_MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 6 * 3_600_000;
/** How long a claimed page stays invisible to other runs. */
const LEASE_MS = 15 * 60_000;
const BUDGET_PAUSE_MS = 60 * 60_000;

export interface OcrDrainDeps {
  db: Queryable;
  ocr: OcrPort;
  renderer: PageRenderer;
  /** Reads an original PDF by object key (`corpus/<sha256>.pdf`). */
  readBlob: (key: string) => Promise<Uint8Array>;
  now?: () => Date;
}

export interface OcrDrainBudget {
  maxPages: number;
  maxBytes: number;
  /** Pages claimed at a time. */
  batchSize?: number;
  maxAttempts?: number;
}

export const DEFAULT_OCR_DRAIN_BUDGET: OcrDrainBudget = {
  maxPages: 50,
  maxBytes: 200 * 1024 * 1024,
  batchSize: 5,
};

export interface OcrDrainReport {
  claimed: number;
  done: number;
  retried: number;
  parked: number;
  bytes: number;
  /** The page, byte or AI budget stopped the run before the queue was empty. */
  budgetReached: boolean;
}

interface Claimed {
  id: string;
  judgmentId: string;
  pageNo: number;
  attempts: number;
}

/** The backoff before attempt number `attempts` (1-based count of failures so far). */
export function ocrBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

async function claim(db: Queryable, limit: number, now: Date): Promise<Claimed[]> {
  const lease = new Date(now.getTime() + LEASE_MS);
  // nosemgrep: infra.security.semgrep.causedeck.raw-sql-bypasses-with-workspace -- corpus_ocr_queue is a global platform table (no workspace_id, no RLS); public judgments only
  const rows = await db.execute(sql`
    update corpus_ocr_queue q
    set next_attempt_at = ${lease.toISOString()}::timestamptz
    where q.id in (
      select id from corpus_ocr_queue
      where parked_at is null and next_attempt_at <= ${now.toISOString()}::timestamptz
      order by created_at, page_no
      limit ${limit}
      for update skip locked
    )
    returning q.id as id, q.judgment_id as "judgmentId", q.page_no as "pageNo", q.attempts as attempts
  `);
  return Array.from(rows as unknown as Claimed[]);
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const name = error instanceof Error ? error.name : 'Error';
  return (typeof code === 'string' ? code : name).slice(0, 100);
}

const isBudgetError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'BUDGET_EXCEEDED';

/** Store the page text and drop the queue row together. */
async function storePage(db: Queryable, row: Claimed, text: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ pageText: judgment.pageText })
      .from(judgment)
      .where(eq(judgment.id, row.judgmentId))
      .for('update');
    if (target === undefined) throw new Error('judgment missing');
    const pages = target.pageText.some((p) => p.pageNo === row.pageNo)
      ? target.pageText.map((p) =>
          p.pageNo === row.pageNo ? { ...p, text, source: 'ocr' as const } : p,
        )
      : [...target.pageText, { pageNo: row.pageNo, text, source: 'ocr' as const }];
    await tx.update(judgment).set({ pageText: pages }).where(eq(judgment.id, row.judgmentId));
    await tx.delete(corpusOcrQueue).where(eq(corpusOcrQueue.id, row.id));
  });
}

async function fail(
  db: Queryable,
  row: Claimed,
  error: unknown,
  now: Date,
  maxAttempts: number,
): Promise<'retried' | 'parked'> {
  const attempts = row.attempts + 1;
  const parked = attempts >= maxAttempts;
  await db
    .update(corpusOcrQueue)
    .set({
      attempts,
      lastError: errorCode(error),
      nextAttemptAt: new Date(now.getTime() + ocrBackoffMs(attempts)),
      parkedAt: parked ? now : null,
    })
    .where(eq(corpusOcrQueue.id, row.id));
  return parked ? 'parked' : 'retried';
}

/** One queued page: read the PDF, render the page, OCR it, store the text. Throws on any failure. */
async function ocrOne(
  deps: OcrDrainDeps,
  row: Claimed,
  pdfs: Map<string, Uint8Array>,
  report: OcrDrainReport,
): Promise<void> {
  const [target] = await deps.db
    .select({ sha256: judgment.sha256, blobKey: judgment.blobKey })
    .from(judgment)
    .where(eq(judgment.id, row.judgmentId))
    .limit(1);
  if (target === undefined) throw new Error('judgment missing');
  const key = target.blobKey ?? corpusBlobKey(target.sha256);
  let bytes = pdfs.get(key);
  if (bytes === undefined) {
    bytes = await deps.readBlob(key);
    pdfs.set(key, bytes);
    report.bytes += bytes.byteLength;
  }
  const doc = await deps.renderer.open(bytes, 'application/pdf');
  try {
    const { png } = await doc.renderPage(row.pageNo, OCR_DPI);
    const result = await deps.ocr.ocrPage({ pageNo: row.pageNo, png });
    await storePage(deps.db, row, result.text);
  } finally {
    doc.close();
  }
}

export async function drainOcrQueue(
  deps: OcrDrainDeps,
  budget: OcrDrainBudget = DEFAULT_OCR_DRAIN_BUDGET,
  signal?: AbortSignal,
): Promise<OcrDrainReport> {
  const now = deps.now ?? (() => new Date());
  const maxAttempts = budget.maxAttempts ?? OCR_MAX_ATTEMPTS;
  const report: OcrDrainReport = {
    claimed: 0,
    done: 0,
    retried: 0,
    parked: 0,
    bytes: 0,
    budgetReached: false,
  };
  while (!signal?.aborted) {
    const room = budget.maxPages - report.claimed;
    if (room <= 0 || report.bytes >= budget.maxBytes) {
      report.budgetReached = true;
      break;
    }
    const rows = await claim(deps.db, Math.min(room, budget.batchSize ?? 5), now());
    if (rows.length === 0) break;
    report.claimed += rows.length;
    const pdfs = new Map<string, Uint8Array>();
    for (const row of rows) {
      try {
        await ocrOne(deps, row, pdfs, report);
        report.done += 1;
      } catch (error) {
        if (isBudgetError(error)) {
          // The platform AI budget is spent: not the page's fault, so no attempt is counted.
          await deps.db
            .update(corpusOcrQueue)
            .set({ nextAttemptAt: new Date(now().getTime() + BUDGET_PAUSE_MS) })
            .where(eq(corpusOcrQueue.id, row.id));
          report.budgetReached = true;
          return report;
        }
        report[await fail(deps.db, row, error, now(), maxAttempts)] += 1;
      }
    }
  }
  return report;
}
