// The bootstrap import batch (#57 part 4, #550): what runs between the drop and the plan. A batch
// links already uploaded `bulk_import` captures (`import_batch_file`, one per capture) and moves
// through `pending -> processing -> ready`. `processImportFile` reads one file once its capture left
// the pipeline: a cause list goes to the court adapter that reads it (chosen by detection over the
// dedicated adapters; a list no dedicated adapter reads is kept as an attachment with a
// needs-a-dedicated-adapter note), a diary photo or an order is left to its own pipeline step and is
// counted as parsed. Only rows that match the advocate (matched-only rule, #548) are staged as
// proposals, so the content of another advocate's row is never stored. `finishImportBatch` builds the
// plan once no file is waiting. The job bodies in `jobs/definitions/import-batch.ts` wrap these.
// Counts only are logged.
import {
  createKarnatakaHcAdapter,
  createMadrasHcAdapter,
  createNcltAdapter,
  type Advocate,
  type CourtAdapter,
  type ParsedCauseList,
  type ParsedListRow,
} from '@causedeck/adapters';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';

import { submitProposals } from '../automation/index.ts';
import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';
import { conflict, notFound } from '../shared/errors.ts';

import { buildImportPlan } from './bootstrap.ts';
import { documentPageCounts } from './entitlements.ts';
import { filterMatchedRows } from './filter-rows.ts';
import { hasIdentifiers } from './identifiers.ts';
import { getAdvocateProfile } from './profile.ts';

/** `import_batch_file.adapter_id` of a list no dedicated adapter reads: kept as an attachment. */
export const NEEDS_DEDICATED_ADAPTER = 'needs_dedicated_adapter';
/** `import_batch_file.adapter_id` of a file past the free-plan OCR cap: kept, never read. */
export const OVER_OCR_CAP = 'over_ocr_cap';
/** The note kept on the capture of an attachment-only list. */
export const NEEDS_ADAPTER_NOTE = 'needs a dedicated adapter';

type ImportBatchFileStatus = schema.ImportBatchFileStatus;
type ImportBatchStatus = schema.ImportBatchStatus;

const TERMINAL: readonly ImportBatchFileStatus[] = ['parsed', 'unmatched'];
const OPEN_BATCH: readonly ImportBatchStatus[] = ['pending', 'processing', 'ready', 'failed'];
const WAITING_CAPTURE = ['received', 'scanning', 'queued', 'processing'];
const MAX_FILES = 500;

export interface ImportBatchDeps {
  db: Database | Transaction;
  now?: () => Date;
  /** Counts only: never row content. */
  log?: (event: string, counts: Record<string, number>) => void;
  /** Reads a cause list; defaults to the dedicated court adapters (tests inject a mock). */
  parser?: ListParser;
}

export interface ListParseInput {
  fileName: string | null;
  /** ISO timestamp the lawyer supplied the document. */
  receivedAt: string;
  /** The text of the document, pages separated by a form feed. */
  text: string;
}

export type ListParseResult =
  { outcome: 'parsed'; adapterId: string; list: ParsedCauseList } | { outcome: 'needs_adapter' };

export type ListParser = (input: ListParseInput) => Promise<ListParseResult>;

/**
 * A parser that tries each adapter and keeps the one that read the most rows (detection by
 * content: the forum of a drop is not known). A document no adapter reads as a list is
 * `needs_adapter`.
 */
export function createListParser(adapters: readonly CourtAdapter[]): ListParser {
  const ordered = [...adapters].sort((a, b) => a.id.localeCompare(b.id));
  return async (input) => {
    let best: { adapterId: string; list: ParsedCauseList } | null = null;
    for (const adapter of ordered) {
      const forumCode = adapter.forumCodes[0];
      if (forumCode === undefined) continue;
      try {
        const list = await adapter.parseCauseList({
          kind: 'text',
          text: input.text,
          meta: {
            ...(input.fileName === null ? {} : { fileName: input.fileName }),
            receivedAt: input.receivedAt,
            forumCode,
          },
        });
        const readable = list.status === undefined || list.status === 'ok';
        if (readable && list.rows.length > (best?.list.rows.length ?? 0)) {
          best = { adapterId: adapter.id, list };
        }
      } catch {
        // An adapter that cannot read the document is not the one for it.
      }
    }
    return best === null ? { outcome: 'needs_adapter' } : { outcome: 'parsed', ...best };
  };
}

let defaultParser: ListParser | undefined;
function dedicatedParser(): ListParser {
  defaultParser ??= createListParser([
    createMadrasHcAdapter(),
    createKarnatakaHcAdapter(),
    createNcltAdapter(),
  ]);
  return defaultParser;
}

const NO_EVENTS: MatterGraphDeps['events'] = {
  emit() {
    // Staging a proposal has no event subscribers.
  },
};

const fileWhere = (workspaceId: string, batchId: string) =>
  and(
    eq(schema.importBatchFile.workspaceId, workspaceId),
    eq(schema.importBatchFile.batchId, batchId),
  );

async function lockBatch(tx: Transaction, workspaceId: string, batchId: string) {
  const { importBatch } = schema;
  const [batch] = await tx
    .select({
      id: importBatch.id,
      status: importBatch.status,
      createdBy: importBatch.createdBy,
    })
    .from(importBatch)
    .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)))
    .for('update');
  if (batch === undefined) throw notFound('Import batch not found');
  return batch;
}

async function setBatchStatus(
  tx: Transaction,
  workspaceId: string,
  batchId: string,
  status: ImportBatchStatus,
): Promise<void> {
  const { importBatch } = schema;
  await tx
    .update(importBatch)
    .set({ status })
    .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)));
}

/** A new, empty batch for the acting member. */
export async function createImportBatch(
  deps: ImportBatchDeps,
  actor: GraphActor,
): Promise<{ batchId: string }> {
  const { importBatch } = schema;
  return withWorkspace(deps.db, actor, async (tx) => {
    const [row] = await tx
      .insert(importBatch)
      .values({ workspaceId: actor.workspaceId, createdBy: actor.userId })
      .returning({ id: importBatch.id });
    if (row === undefined) throw new Error('import batch insert returned no row');
    return { batchId: row.id };
  });
}

/**
 * Link uploaded captures to the batch. Only `bulk_import` captures of this workspace count (an id
 * of another workspace is not visible under RLS and is skipped); a capture already in the batch is
 * skipped. A plan built earlier is stale, so a ready or failed batch goes back to `pending`.
 */
export async function addImportFiles(
  deps: ImportBatchDeps,
  actor: GraphActor,
  input: { batchId: string; captureIds: readonly string[] },
): Promise<{ added: number; skipped: number }> {
  const { importBatch, importBatchFile, capture } = schema;
  const { workspaceId } = actor;
  const ids = [...new Set(input.captureIds)];
  return withWorkspace(deps.db, actor, async (tx) => {
    const batch = await lockBatch(tx, workspaceId, input.batchId);
    if (!OPEN_BATCH.includes(batch.status)) throw conflict('The batch was already applied');
    const [existing] = await tx
      .select({ n: count() })
      .from(importBatchFile)
      .where(fileWhere(workspaceId, input.batchId));
    if ((existing?.n ?? 0) + ids.length > MAX_FILES) {
      throw conflict(`A batch holds at most ${String(MAX_FILES)} files`);
    }
    const visible =
      ids.length === 0
        ? []
        : await tx
            .select({ id: capture.id })
            .from(capture)
            .where(
              and(
                eq(capture.workspaceId, workspaceId),
                eq(capture.channel, 'bulk_import'),
                inArray(capture.id, ids),
              ),
            );
    const added =
      visible.length === 0
        ? []
        : await tx
            .insert(importBatchFile)
            .values(
              visible.map((row) => ({ workspaceId, batchId: input.batchId, captureId: row.id })),
            )
            .onConflictDoNothing()
            .returning({ id: importBatchFile.id });
    if (added.length > 0) {
      const [total] = await tx
        .select({ n: count() })
        .from(importBatchFile)
        .where(fileWhere(workspaceId, input.batchId));
      await tx
        .update(importBatch)
        .set({
          fileCount: total?.n ?? 0,
          ...(batch.status === 'ready' || batch.status === 'failed'
            ? { status: 'pending' as const }
            : {}),
        })
        .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, input.batchId)));
    }
    return { added: added.length, skipped: ids.length - added.length };
  });
}

export interface ImportProgress {
  batchId: string;
  status: ImportBatchStatus;
  total: number;
  files: Record<ImportBatchFileStatus, number>;
  matchedRows: number;
  /** The importing member has no saved identifiers: no list row can be imported. */
  needsIdentifiers: boolean;
}

/** Per-file progress of a batch: counts by file status, never content. */
export async function getImportProgress(
  deps: ImportBatchDeps,
  actor: GraphActor,
  batchId: string,
): Promise<ImportProgress> {
  const { importBatch, importBatchFile } = schema;
  const { workspaceId } = actor;
  const [counts, batch] = await withWorkspace(deps.db, actor, async (tx) => {
    const [row] = await tx
      .select({
        status: importBatch.status,
        matchedRows: importBatch.matchedRows,
        createdBy: importBatch.createdBy,
      })
      .from(importBatch)
      .where(and(eq(importBatch.workspaceId, workspaceId), eq(importBatch.id, batchId)));
    if (row === undefined) throw notFound('Import batch not found');
    const grouped = await tx
      .select({ status: importBatchFile.status, n: count() })
      .from(importBatchFile)
      .where(fileWhere(workspaceId, batchId))
      .groupBy(importBatchFile.status);
    return [grouped, row] as const;
  });
  const files: Record<ImportBatchFileStatus, number> = {
    pending: 0,
    processing: 0,
    parsed: 0,
    unmatched: 0,
    failed: 0,
  };
  for (const row of counts) files[row.status] = row.n;
  const identifiers = await getAdvocateProfile(deps.db, {
    workspaceId,
    userId: batch.createdBy ?? actor.userId,
  });
  return {
    batchId,
    status: batch.status,
    total: Object.values(files).reduce((sum, n) => sum + n, 0),
    files,
    matchedRows: batch.matchedRows,
    needsIdentifiers: !hasIdentifiers(identifiers),
  };
}

export interface PendingImportFile {
  captureId: string;
  status: ImportBatchFileStatus;
  /** Pages of its document (1 when it has none yet): what reading it costs against the OCR cap. */
  pages: number;
}

/**
 * Put the batch in `processing` and list the files to run. `pending` files always run; `failed`
 * ones with `reprocess` `failed`; `failed` and the unmatched ones a profile change can rescue (not
 * attachments) with `reprocess` `unmatched`. Reprocessed files go back to `pending`.
 */
export async function startImportProcessing(
  deps: ImportBatchDeps,
  input: { workspaceId: string; batchId: string; reprocess?: 'failed' | 'unmatched' | undefined },
): Promise<PendingImportFile[]> {
  const { importBatchFile, document } = schema;
  const { workspaceId, batchId } = input;
  const files = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const batch = await lockBatch(tx, workspaceId, batchId);
    if (!OPEN_BATCH.includes(batch.status)) throw conflict('The batch was already applied');
    const redo: ImportBatchFileStatus[] =
      input.reprocess === 'unmatched' ? ['failed', 'unmatched'] : input.reprocess ? ['failed'] : [];
    const rows = await tx
      .select({
        captureId: importBatchFile.captureId,
        status: importBatchFile.status,
        adapterId: importBatchFile.adapterId,
      })
      .from(importBatchFile)
      .where(fileWhere(workspaceId, batchId))
      .orderBy(asc(importBatchFile.createdAt), asc(importBatchFile.captureId));
    const run = rows.filter(
      (row) =>
        row.status === 'pending' ||
        (redo.includes(row.status) &&
          row.adapterId !== NEEDS_DEDICATED_ADAPTER &&
          row.adapterId !== OVER_OCR_CAP),
    );
    const redoIds = run.filter((row) => row.status !== 'pending').map((row) => row.captureId);
    if (redoIds.length > 0) {
      await tx
        .update(importBatchFile)
        .set({ status: 'pending', rowsMatched: 0 })
        .where(and(fileWhere(workspaceId, batchId), inArray(importBatchFile.captureId, redoIds)));
    }
    await setBatchStatus(tx, workspaceId, batchId, 'processing');
    const docs =
      run.length === 0
        ? []
        : await tx
            .select({ id: document.id, captureId: document.sourceCaptureId })
            .from(document)
            .where(
              and(
                eq(document.workspaceId, workspaceId),
                inArray(
                  document.sourceCaptureId,
                  run.map((row) => row.captureId),
                ),
              ),
            );
    return { run, docs };
  });
  const pageCounts = await documentPageCounts(
    deps.db,
    workspaceId,
    files.docs.map((doc) => doc.id),
  );
  const docOf = new Map(files.docs.map((doc) => [doc.captureId, doc.id]));
  return files.run.map((row) => ({
    captureId: row.captureId,
    status: row.status,
    pages: pageCounts.get(docOf.get(row.captureId) ?? '') ?? 1,
  }));
}

async function setFile(
  tx: Transaction,
  where: { workspaceId: string; batchId: string; captureId: string },
  set: { status: ImportBatchFileStatus; adapterId?: string | null; rowsMatched?: number },
): Promise<void> {
  const { importBatchFile } = schema;
  await tx
    .update(importBatchFile)
    .set(set)
    .where(
      and(
        fileWhere(where.workspaceId, where.batchId),
        eq(importBatchFile.captureId, where.captureId),
      ),
    );
}

/** Keep files past the OCR cap as attachments: they are not read and no AI is called for them. */
export async function markImportFilesOverCap(
  deps: ImportBatchDeps,
  input: { workspaceId: string; batchId: string; captureIds: readonly string[] },
): Promise<void> {
  const { importBatchFile } = schema;
  if (input.captureIds.length === 0) return;
  await withWorkspace(deps.db, { workspaceId: input.workspaceId }, (tx) =>
    tx
      .update(importBatchFile)
      .set({ status: 'unmatched', adapterId: OVER_OCR_CAP, rowsMatched: 0 })
      .where(
        and(
          fileWhere(input.workspaceId, input.batchId),
          inArray(importBatchFile.captureId, [...input.captureIds]),
        ),
      ),
  );
}

/** A file whose retries ran out: failed, so the batch can finish without it and it can be retried. */
export async function markImportFileFailed(
  deps: ImportBatchDeps,
  input: { workspaceId: string; batchId: string; captureId: string },
): Promise<void> {
  await withWorkspace(deps.db, { workspaceId: input.workspaceId }, (tx) =>
    setFile(tx, input, { status: 'failed' }),
  );
}

const text = (value: string | undefined | null): string | null =>
  value === undefined || value === null || value.trim() === '' ? null : value.trim();

/** The payload of a staged list row, in the shape `buildImportPlan` reads. */
function rowPayload(
  list: ParsedCauseList,
  row: ParsedListRow,
  key: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    matchKey: key,
    forumCode: list.forumCode,
    advocates: (row.advocates ?? []).map((advocate: Advocate) => ({
      raw: advocate.raw,
      aliases: advocate.aliases,
      ...(advocate.enrolmentNo === undefined ? {} : { enrolmentNo: advocate.enrolmentNo }),
    })),
    ...fields,
  };
  if (list.listDate !== null) payload['listDate'] = list.listDate;
  const parties = text(row.parties);
  if (parties !== null && fields['parties'] === undefined) payload['parties'] = parties;
  const stage = text(row.stageRaw);
  if (stage !== null && fields['stageRaw'] === undefined) payload['stageRaw'] = stage;
  return payload;
}

/**
 * The payloads of the proposals one matched list row stages: the row itself and, per child
 * reference filed in it (an `IA` or `W.M.P.`), one that names the row as its parent. Pure.
 */
export function listRowPayloads(
  list: ParsedCauseList,
  row: ParsedListRow,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (row.matchKey !== null) {
    out.push(
      rowPayload(list, row, row.matchKey, {
        caseTypeRaw: row.caseTypeRaw,
        ...(row.caseNumber === null ? {} : { caseNumber: row.caseNumber }),
        ...(row.caseYear === null ? {} : { caseYear: row.caseYear }),
        ...(row.parentProceedingKey == null
          ? {}
          : { parentProceedingKey: row.parentProceedingKey }),
      }),
    );
  }
  for (const child of row.children ?? []) {
    if (child.matchKey === null) continue;
    const parent = child.parentProceedingKey ?? row.matchKey;
    out.push(
      rowPayload(list, row, child.matchKey, {
        caseTypeRaw: child.caseTypeRaw,
        caseNumber: child.number,
        caseYear: child.year,
        parties: text(row.parties),
        ...(parent === null ? {} : { parentProceedingKey: parent }),
      }),
    );
  }
  return out;
}

export type ImportFileOutcome =
  | { outcome: 'parsed'; adapterId: string; rows: number }
  | { outcome: 'unmatched'; adapterId: string | null; rows: number }
  | { outcome: 'waiting' }
  | { outcome: 'skipped' }
  | { outcome: 'missing' };

/**
 * Read one file of a batch. Idempotent: a file already `parsed` or `unmatched` is skipped (unless
 * `force`, a reprocess), and a staged row is never staged twice (the engine's idempotency key). A
 * capture still in the pipeline is `waiting`: the job retries with backoff.
 */
export async function processImportFile(
  deps: ImportBatchDeps,
  input: { workspaceId: string; batchId: string; captureId: string; force?: boolean },
): Promise<ImportFileOutcome> {
  const { importBatchFile, capture, document, documentPage, anchor } = schema;
  const { workspaceId, batchId, captureId } = input;
  const owner = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const [batch] = await tx
      .select({ createdBy: schema.importBatch.createdBy })
      .from(schema.importBatch)
      .where(
        and(eq(schema.importBatch.workspaceId, workspaceId), eq(schema.importBatch.id, batchId)),
      );
    return batch === undefined ? null : { userId: batch.createdBy };
  });
  if (owner === null) return { outcome: 'missing' };
  if (owner.userId === null) {
    await markImportFileFailed(deps, input);
    return { outcome: 'missing' };
  }
  const { userId } = owner;
  const now = deps.now ?? (() => new Date());

  return withWorkspace(deps.db, { workspaceId, userId }, async (tx): Promise<ImportFileOutcome> => {
    const [file] = await tx
      .select({ status: importBatchFile.status })
      .from(importBatchFile)
      .where(and(fileWhere(workspaceId, batchId), eq(importBatchFile.captureId, captureId)));
    if (file === undefined) return { outcome: 'missing' };
    if (TERMINAL.includes(file.status) && input.force !== true) return { outcome: 'skipped' };

    const [cap] = await tx
      .select({
        status: capture.status,
        channel: capture.channel,
        fileName: capture.originalFilename,
        createdAt: capture.createdAt,
        sourceMeta: capture.sourceMeta,
      })
      .from(capture)
      .where(and(eq(capture.workspaceId, workspaceId), eq(capture.id, captureId)));
    if (cap === undefined) return { outcome: 'missing' };
    if (WAITING_CAPTURE.includes(cap.status)) return { outcome: 'waiting' };

    const [doc] = await tx
      .select({ id: document.id, kind: document.kind })
      .from(document)
      .where(and(eq(document.workspaceId, workspaceId), eq(document.sourceCaptureId, captureId)))
      .orderBy(asc(document.createdAt))
      .limit(1);
    const where = { workspaceId, batchId, captureId };
    if (doc === undefined) {
      // Nothing was read from the capture (failed, discarded, quarantined): the file is failed.
      await setFile(tx, where, { status: 'failed' });
      return { outcome: 'missing' };
    }
    await setFile(tx, where, { status: 'processing' });

    // A diary photo and an order are structured by their own pipeline steps, which stage proposals
    // for the capture; the plan reads them from there.
    if (cap.channel === 'camera' || doc.kind === 'order' || doc.kind === 'judgment') {
      const adapterId = cap.channel === 'camera' ? 'diary' : 'extraction';
      await setFile(tx, where, { status: 'parsed', adapterId });
      return { outcome: 'parsed', adapterId, rows: 0 };
    }
    if (doc.kind !== 'cause_list') {
      await setFile(tx, where, { status: 'unmatched', adapterId: null });
      return { outcome: 'unmatched', adapterId: null, rows: 0 };
    }

    const pages = await tx
      .select({ pageNo: documentPage.pageNo, text: documentPage.text })
      .from(documentPage)
      .where(and(eq(documentPage.workspaceId, workspaceId), eq(documentPage.documentId, doc.id)))
      .orderBy(asc(documentPage.pageNo));
    const parse = deps.parser ?? dedicatedParser();
    const parsed = await parse({
      fileName: cap.fileName,
      receivedAt: cap.createdAt.toISOString(),
      text: pages.map((page) => page.text ?? '').join('\f'),
    });
    if (parsed.outcome === 'needs_adapter') {
      await tx
        .update(capture)
        .set({
          sourceMeta: sql`${capture.sourceMeta} || ${JSON.stringify({ importNote: NEEDS_ADAPTER_NOTE })}::jsonb`,
        })
        .where(and(eq(capture.workspaceId, workspaceId), eq(capture.id, captureId)));
      await setFile(tx, where, { status: 'unmatched', adapterId: NEEDS_DEDICATED_ADAPTER });
      deps.log?.('import.file_attached', { rows: 0 });
      return { outcome: 'unmatched', adapterId: NEEDS_DEDICATED_ADAPTER, rows: 0 };
    }

    // The matched-only rule runs before anything is stored.
    const identifiers = await getAdvocateProfile(tx, { workspaceId, userId });
    const { matched, unmatchedCount } = filterMatchedRows(parsed.list.rows, identifiers);
    const drafts: unknown[] = [];
    for (const row of matched) {
      const payloads = listRowPayloads(parsed.list, row);
      if (payloads.length === 0) continue;
      const [stored] = await tx
        .insert(anchor)
        .values({
          workspaceId,
          documentId: doc.id,
          pageNo: row.anchor.page,
          quote: row.anchor.quote.slice(0, schema.ANCHOR_QUOTE_MAX),
          kind: 'document',
        })
        .returning({ id: anchor.id });
      if (stored === undefined) throw new Error('anchor insert returned no row');
      for (const payload of payloads) {
        drafts.push({
          kind: 'new_proceeding',
          captureId,
          source: { type: 'deterministic', input: 'list', ref: doc.id },
          payload,
          anchors: [stored.id],
          confidence: row.confidence,
          // A score only: an exact match would let the engine apply the draft unasked.
          match: { score: row.confidence },
          patternKey: 'import:list_row',
        });
      }
    }
    if (drafts.length > 0) {
      await submitProposals({ db: tx, events: NO_EVENTS, now }, { workspaceId, userId }, drafts);
    }
    const rows = drafts.length;
    deps.log?.('import.file_read', { rows, unmatched: unmatchedCount });
    if (rows === 0) {
      await setFile(tx, where, { status: 'unmatched', adapterId: parsed.adapterId });
      return { outcome: 'unmatched', adapterId: parsed.adapterId, rows };
    }
    await setFile(tx, where, { status: 'parsed', adapterId: parsed.adapterId, rowsMatched: rows });
    return { outcome: 'parsed', adapterId: parsed.adapterId, rows };
  });
}

export type FinishImportOutcome =
  | { outcome: 'ready'; matters: number; matchedRows: number }
  | { outcome: 'needs_identifiers' }
  | { outcome: 'waiting' }
  | { outcome: 'failed' }
  | { outcome: 'final' }
  | { outcome: 'empty' };

/**
 * End a batch once no file is `pending` or `processing`: without identifiers the batch goes back to
 * `pending` and asks for them; with every file failed it is `failed`; otherwise the plan is built
 * and the batch is `ready`. Safe to call from every file job: the batch row is locked and a second
 * call rebuilds the same plan.
 */
export async function finishImportBatch(
  deps: ImportBatchDeps,
  input: { workspaceId: string; batchId: string },
): Promise<FinishImportOutcome> {
  const { importBatchFile } = schema;
  const { workspaceId, batchId } = input;
  const state = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const batch = await lockBatch(tx, workspaceId, batchId);
    if (batch.status === 'applied' || batch.status === 'undone') return { final: true } as const;
    const grouped = await tx
      .select({ status: importBatchFile.status, n: count() })
      .from(importBatchFile)
      .where(fileWhere(workspaceId, batchId))
      .groupBy(importBatchFile.status);
    const n = (status: ImportBatchFileStatus) => grouped.find((g) => g.status === status)?.n ?? 0;
    const total = grouped.reduce((sum, g) => sum + g.n, 0);
    const waiting = n('pending') + n('processing') > 0;
    const identifiers =
      batch.createdBy === null
        ? { enrolmentNumbers: [], aliases: [] }
        : await getAdvocateProfile(tx, { workspaceId, userId: batch.createdBy });
    if (total > 0 && !waiting) {
      const verdict = hasIdentifiers(identifiers)
        ? n('failed') === total
          ? 'failed'
          : 'build'
        : 'identifiers';
      await setBatchStatus(
        tx,
        workspaceId,
        batchId,
        verdict === 'failed' ? 'failed' : verdict === 'build' ? 'processing' : 'pending',
      );
      return { final: false, total, waiting, verdict, identifiers } as const;
    }
    return { final: false, total, waiting, verdict: null, identifiers } as const;
  });
  if (state.final) return { outcome: 'final' };
  if (state.total === 0) return { outcome: 'empty' };
  if (state.waiting) return { outcome: 'waiting' };
  if (state.verdict === 'identifiers') return { outcome: 'needs_identifiers' };
  if (state.verdict === 'failed') return { outcome: 'failed' };
  const plan = await buildImportPlan(
    { db: deps.db, ...(deps.now ? { now: deps.now } : {}), ...(deps.log ? { log: deps.log } : {}) },
    { workspaceId, batchId, identifiers: state.identifiers },
  );
  await withWorkspace(deps.db, { workspaceId }, (tx) =>
    setBatchStatus(tx, workspaceId, batchId, 'ready'),
  );
  return { outcome: 'ready', matters: plan.matters.length, matchedRows: plan.counts.matchedRows };
}
