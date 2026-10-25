// The migration concierge (#685, part of #508): a bulk matter import in runs. A dry run reads the
// file and reports mapping issues without writing a matter, proceeding or import batch. An import
// run splits the valid rows into chunks, each stored as its own import batch with its plan up
// front, so the run resumes at the next chunk without the file and rolls back with
// `undoImportBatch`. Rows hold states, counts and issue codes only, never the content of a row.
import { isUuid, schema, withWorkspace } from '@causedeck/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import {
  applyImportPlan,
  istDay,
  undoImportBatch,
  type ApplyDeps,
  type ImportPlan,
  type PlanMatter,
} from '../import/index.ts';
import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import { memberRole } from '../workspaces/index.ts';

import {
  BLOCKING_ISSUES,
  parseMigrationCsv,
  type ColumnMapping,
  type MigrationIssueCode,
  type MigrationRow,
} from './csv.ts';

const { migrationRun, migrationRunRow, importBatch, importPlan, forum } = schema;

/** Rows of one chunk: one import batch, applied in one transaction. */
export const MIGRATION_CHUNK_SIZE = 250;
const ROW_INSERT_BATCH = 500;

export type MigrationDeps = ApplyDeps;

type MigrationRunRow = typeof migrationRun.$inferSelect;
type MigrationMode = MigrationRunRow['mode'];
type RunStatus = MigrationRunRow['status'];
type RowState = (typeof migrationRunRow.$inferSelect)['state'];

export interface MigrationActor {
  userId: string;
  workspaceId: string;
}

/** What `report` holds: row issues (codes only) and one entry per chunk of an import run. */
export type MigrationReportEntry =
  | { kind: 'issue'; row: number; code: MigrationIssueCode }
  | { kind: 'file'; code: 'missing_column'; field: string }
  | { kind: 'chunk'; index: number; batchId: string; rows: number[]; done: boolean };

type ChunkEntry = Extract<MigrationReportEntry, { kind: 'chunk' }>;

export interface MigrationProgress {
  runId: string;
  mode: MigrationMode;
  status: RunStatus;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  /** The next row index to process. */
  resumeFrom: number;
  chunks: { total: number; done: number };
  rolledBackAt: Date | null;
}

export interface MigrationReport {
  runId: string;
  mode: MigrationMode;
  /** Issue count per code. */
  issueCounts: Partial<Record<MigrationIssueCode, number>>;
  /** Row numbers (1-based, header excluded) with their issue codes: no row content. */
  issues: { row: number; code: MigrationIssueCode }[];
  missingColumns: string[];
}

async function requireOwner(deps: MigrationDeps, actor: MigrationActor): Promise<void> {
  const role = await memberRole(deps.db, actor.userId, actor.workspaceId);
  if (role === null) throw notFound('Migration run not found');
  if (role !== 'owner') throw forbidden();
}

async function requireMember(deps: MigrationDeps, actor: MigrationActor): Promise<void> {
  if ((await memberRole(deps.db, actor.userId, actor.workspaceId)) === null) {
    throw notFound('Migration run not found');
  }
}

const nowOf = (deps: MigrationDeps): Date => (deps.now ?? (() => new Date()))();

function matterOf(row: MigrationRow): PlanMatter {
  const key = `r${String(row.index)}`;
  const nextDate = row.nextDate === null ? null : { date: row.nextDate, sources: [] };
  return {
    tempId: key,
    title: row.title,
    proceedings: [
      {
        key,
        label: null,
        caseType: row.caseType,
        caseNumber: row.caseNumber,
        caseYear: row.caseYear,
        forumCode: row.forumCode,
        cnr: row.cnr,
        parentKey: null,
        parties: row.parties,
        stage: row.stage,
        nextDate,
        nextDateCandidates: nextDate === null ? [] : [nextDate],
        sources: [],
      },
    ],
    nextDate,
    issues: [],
    confidence: 1,
    reason: 'migration file row',
    sources: [],
  };
}

const rowIndexOf = (tempId: string): number => Number(tempId.slice(1));

export interface StartMigrationInput {
  mode: MigrationMode;
  csv: string;
  mapping: ColumnMapping;
  /** Rows per chunk, 1 to `MIGRATION_CHUNK_SIZE` (default). */
  chunkSize?: number;
}

/**
 * Read the file and open a run. A `dry_run` stores only the run, its row states and the report. An
 * `import` stores the chunks as ready import batches (nothing is applied until `runMigrationChunk`).
 * FORBIDDEN unless the actor owns the workspace; VALIDATION for an empty file or one over 5,000 rows.
 */
export async function startMigrationRun(
  deps: MigrationDeps,
  actor: MigrationActor,
  input: StartMigrationInput,
): Promise<MigrationProgress> {
  await requireOwner(deps, actor);
  const now = nowOf(deps);
  let parsed;
  try {
    parsed = parseMigrationCsv(input.csv, input.mapping, istDay(now));
  } catch (error) {
    if (error instanceof RangeError) throw invalid(error.message);
    throw error;
  }
  const { rows, missingColumns } = parsed;
  const chunkSize = Math.min(
    Math.max(input.chunkSize ?? MIGRATION_CHUNK_SIZE, 1),
    MIGRATION_CHUNK_SIZE,
  );
  if (rows.length === 0) throw invalid('The file has no rows');
  const { workspaceId, userId } = actor;
  const runId = await withWorkspace(deps.db, actor, async (tx) => {
    const codes = [...new Set(rows.flatMap((r) => (r.forumCode === null ? [] : [r.forumCode])))];
    const known = new Set(
      codes.length === 0
        ? []
        : (await tx.select({ code: forum.code }).from(forum).where(inArray(forum.code, codes))).map(
            (f) => f.code,
          ),
    );
    for (const row of rows) {
      if (row.forumCode !== null && !known.has(row.forumCode)) row.issues.push('unknown_forum');
    }
    const blocked = (r: MigrationRow) => r.issues.some((c) => BLOCKING_ISSUES.has(c));
    const valid = rows.filter((r) => !blocked(r));
    const report: MigrationReportEntry[] = [
      ...missingColumns.map((field): MigrationReportEntry => ({
        kind: 'file',
        code: 'missing_column',
        field,
      })),
      ...rows.flatMap((r) =>
        r.issues.map((code): MigrationReportEntry => ({ kind: 'issue', row: r.index + 1, code })),
      ),
    ];
    const dry = input.mode === 'dry_run';
    const chunks: ChunkEntry[] = [];
    if (!dry) {
      for (let at = 0; at < valid.length; at += chunkSize) {
        const part = valid.slice(at, at + chunkSize);
        const [batch] = await tx
          .insert(importBatch)
          .values({
            workspaceId,
            createdBy: userId,
            status: 'ready',
            matchedRows: part.length,
          })
          .returning({ id: importBatch.id });
        if (batch === undefined) throw new Error('import batch insert returned no row');
        const plan: ImportPlan = {
          version: 1,
          today: istDay(now),
          matters: part.map(matterOf),
          history: [],
          obligations: [],
          counts: { matchedRows: part.length, unmatchedRowsCount: 0 },
        };
        await tx.insert(importPlan).values({
          workspaceId,
          batchId: batch.id,
          plan: plan as unknown as Record<string, unknown>,
        });
        chunks.push({
          kind: 'chunk',
          index: chunks.length,
          batchId: batch.id,
          rows: part.map((r) => r.index),
          done: false,
        });
      }
    }
    const errorRows = rows.length - valid.length;
    const [run] = await tx
      .insert(migrationRun)
      .values({
        workspaceId,
        mode: input.mode,
        status: dry || chunks.length === 0 ? 'succeeded' : 'queued',
        totalRows: rows.length,
        processedRows: dry || chunks.length === 0 ? rows.length : errorRows,
        errorRows,
        resumeFrom: 0,
        report: [...report, ...chunks],
        createdBy: userId,
        ...(dry || chunks.length === 0 ? { startedAt: now, finishedAt: now } : {}),
      })
      .returning({ id: migrationRun.id });
    if (run === undefined) throw new Error('migration run insert returned no row');
    for (let at = 0; at < rows.length; at += ROW_INSERT_BATCH) {
      await tx.insert(migrationRunRow).values(
        rows.slice(at, at + ROW_INSERT_BATCH).map((r) => ({
          workspaceId,
          runId: run.id,
          rowIndex: r.index,
          state: blocked(r) ? ('error' as const) : dry ? ('ok' as const) : ('pending' as const),
          error: blocked(r) ? r.issues.filter((c) => BLOCKING_ISSUES.has(c)).join(',') : null,
        })),
      );
    }
    return run.id;
  });
  deps.log?.('migration.started', { rows: rows.length });
  return getMigrationProgress(deps, actor, { runId });
}

async function loadRun(
  tx: Parameters<Parameters<typeof withWorkspace>[2]>[0],
  actor: MigrationActor,
  runId: string,
  lock = false,
) {
  if (!isUuid(runId)) throw notFound('Migration run not found');
  const query = tx
    .select()
    .from(migrationRun)
    .where(and(eq(migrationRun.workspaceId, actor.workspaceId), eq(migrationRun.id, runId)));
  const [run] = await (lock ? query.for('update') : query);
  if (run === undefined) throw notFound('Migration run not found');
  return run;
}

const chunksOf = (report: unknown[]): ChunkEntry[] =>
  (report as MigrationReportEntry[]).filter((e): e is ChunkEntry => e.kind === 'chunk');

/** Counts of a run for the progress bar. NOT_FOUND for another workspace's run. */
export async function getMigrationProgress(
  deps: MigrationDeps,
  actor: MigrationActor,
  input: { runId: string },
): Promise<MigrationProgress> {
  await requireMember(deps, actor);
  const run = await withWorkspace(deps.db, actor, (tx) => loadRun(tx, actor, input.runId));
  const chunks = chunksOf(run.report);
  return {
    runId: run.id,
    mode: run.mode,
    status: run.status,
    totalRows: run.totalRows,
    processedRows: run.processedRows,
    errorRows: run.errorRows,
    resumeFrom: run.resumeFrom,
    chunks: { total: chunks.length, done: chunks.filter((c) => c.done).length },
    rolledBackAt: run.rolledBackAt,
  };
}

/** The mapping issues of a run, by row number and code. */
export async function getMigrationReport(
  deps: MigrationDeps,
  actor: MigrationActor,
  input: { runId: string },
): Promise<MigrationReport> {
  await requireMember(deps, actor);
  const run = await withWorkspace(deps.db, actor, (tx) => loadRun(tx, actor, input.runId));
  const entries = run.report as MigrationReportEntry[];
  const issues = entries.flatMap((e) => (e.kind === 'issue' ? [{ row: e.row, code: e.code }] : []));
  const issueCounts: MigrationReport['issueCounts'] = {};
  for (const { code } of issues) issueCounts[code] = (issueCounts[code] ?? 0) + 1;
  return {
    runId: run.id,
    mode: run.mode,
    issueCounts,
    issues,
    missingColumns: entries.flatMap((e) => (e.kind === 'file' ? [e.field] : [])),
  };
}

/** The workspace's runs, newest first. */
export async function listMigrationRuns(
  deps: MigrationDeps,
  actor: MigrationActor,
  input: { limit?: number } = {},
): Promise<MigrationProgress[]> {
  await requireMember(deps, actor);
  const runs = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select()
      .from(migrationRun)
      .where(eq(migrationRun.workspaceId, actor.workspaceId))
      .orderBy(desc(migrationRun.createdAt))
      .limit(Math.min(input.limit ?? 50, 200)),
  );
  return runs.map((run) => {
    const chunks = chunksOf(run.report);
    return {
      runId: run.id,
      mode: run.mode,
      status: run.status,
      totalRows: run.totalRows,
      processedRows: run.processedRows,
      errorRows: run.errorRows,
      resumeFrom: run.resumeFrom,
      chunks: { total: chunks.length, done: chunks.filter((c) => c.done).length },
      rolledBackAt: run.rolledBackAt,
    };
  });
}

async function setStatus(
  deps: MigrationDeps,
  actor: MigrationActor,
  runId: string,
  status: RunStatus,
  now: Date,
): Promise<void> {
  await withWorkspace(deps.db, actor, (tx) =>
    tx
      .update(migrationRun)
      .set({ status, updatedAt: now })
      .where(and(eq(migrationRun.workspaceId, actor.workspaceId), eq(migrationRun.id, runId))),
  );
}

/**
 * Apply the next chunk that is not done and record its row states. Safe to call again after a
 * crash or a parallel call: `applyImportPlan` is idempotent per batch, and a chunk already
 * recorded is not recorded twice. CONFLICT for a dry run or a rolled-back run.
 */
export async function runMigrationChunk(
  deps: MigrationDeps,
  actor: MigrationActor,
  input: { runId: string },
): Promise<MigrationProgress> {
  await requireOwner(deps, actor);
  const now = nowOf(deps);
  const run = await withWorkspace(deps.db, actor, (tx) => loadRun(tx, actor, input.runId));
  if (run.mode !== 'import') throw conflict('A dry run has nothing to apply');
  if (run.status === 'rolled_back') throw conflict('This run was rolled back');
  const next = chunksOf(run.report).find((c) => !c.done);
  if (next === undefined) return getMigrationProgress(deps, actor, input);
  if (run.status !== 'running') await setStatus(deps, actor, run.id, 'running', now);
  let result;
  try {
    result = await applyImportPlan(deps, actor, { batchId: next.batchId });
  } catch (error) {
    await setStatus(deps, actor, run.id, 'failed', now);
    throw error;
  }
  const skipped = new Set([
    ...result.excluded.map((e) => rowIndexOf(e.matterTempId)),
    ...result.duplicates.map((d) => rowIndexOf(d.matterTempId)),
  ]);
  const unresolved = new Set(result.unresolvedProceedingKeys.map(rowIndexOf));
  await withWorkspace(deps.db, actor, async (tx) => {
    const current = await loadRun(tx, actor, run.id, true);
    const report = current.report as MigrationReportEntry[];
    const chunk = chunksOf(report).find((c) => c.index === next.index);
    if (chunk === undefined || chunk.done) return;
    const mark = async (state: RowState, indexes: number[], error?: string) => {
      if (indexes.length === 0) return;
      await tx
        .update(migrationRunRow)
        .set({
          state,
          error: error ?? null,
          entityKind: state === 'ok' ? 'import_batch' : null,
          entityId: state === 'ok' ? chunk.batchId : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(migrationRunRow.workspaceId, actor.workspaceId),
            eq(migrationRunRow.runId, run.id),
            inArray(migrationRunRow.rowIndex, indexes),
          ),
        );
    };
    await mark(
      'error',
      chunk.rows.filter((i) => unresolved.has(i)),
      'unresolved_proceeding',
    );
    await mark(
      'skipped',
      chunk.rows.filter((i) => skipped.has(i) && !unresolved.has(i)),
      'duplicate_or_excluded',
    );
    await mark(
      'ok',
      chunk.rows.filter((i) => !skipped.has(i) && !unresolved.has(i)),
    );
    chunk.done = true;
    const finished = chunksOf(report).every((c) => c.done);
    await tx
      .update(migrationRun)
      .set({
        report,
        processedRows: current.processedRows + chunk.rows.length,
        errorRows: current.errorRows + unresolved.size,
        resumeFrom: Math.max(current.resumeFrom, Math.max(...chunk.rows) + 1),
        status: finished ? 'succeeded' : 'running',
        startedAt: current.startedAt ?? now,
        ...(finished ? { finishedAt: now } : {}),
        updatedAt: now,
      })
      .where(and(eq(migrationRun.workspaceId, actor.workspaceId), eq(migrationRun.id, run.id)));
  });
  deps.log?.('migration.chunk', { rows: next.rows.length });
  return getMigrationProgress(deps, actor, input);
}

/** Apply chunks until none is left, or `maxChunks` have run (the caller's time budget). */
export async function resumeMigrationRun(
  deps: MigrationDeps,
  actor: MigrationActor,
  input: { runId: string; maxChunks?: number },
): Promise<MigrationProgress> {
  let progress = await getMigrationProgress(deps, actor, input);
  for (
    let ran = 0;
    progress.chunks.done < progress.chunks.total && ran < (input.maxChunks ?? Infinity);
    ran++
  ) {
    progress = await runMigrationChunk(deps, actor, input);
  }
  return progress;
}

/**
 * Undo every applied chunk (`undoImportBatch`, newest first) and mark the rows rolled back. A chunk
 * already undone is skipped, so a rollback that stopped midway can be run again. CONFLICT for a dry
 * run; the undo window of 7 days applies per chunk (`UndoExpiredError`).
 */
export async function rollbackMigrationRun(
  deps: MigrationDeps,
  actor: MigrationActor,
  input: { runId: string },
): Promise<MigrationProgress> {
  await requireOwner(deps, actor);
  const now = nowOf(deps);
  const run = await withWorkspace(deps.db, actor, (tx) => loadRun(tx, actor, input.runId));
  if (run.mode !== 'import') throw conflict('A dry run has nothing to roll back');
  if (run.status === 'rolled_back') return getMigrationProgress(deps, actor, input);
  if (run.status === 'running') throw conflict('Wait for the running chunk before rolling back');
  const done = chunksOf(run.report)
    .filter((c) => c.done)
    .sort((a, b) => b.index - a.index);
  for (const chunk of done) {
    const [batch] = await withWorkspace(deps.db, actor, (tx) =>
      tx
        .select({ status: importBatch.status })
        .from(importBatch)
        .where(
          and(eq(importBatch.workspaceId, actor.workspaceId), eq(importBatch.id, chunk.batchId)),
        )
        .orderBy(asc(importBatch.createdAt)),
    );
    if (batch?.status === 'applied') await undoImportBatch(deps, actor, { batchId: chunk.batchId });
  }
  await withWorkspace(deps.db, actor, async (tx) => {
    await tx
      .update(migrationRunRow)
      .set({ state: 'rolled_back', updatedAt: now })
      .where(
        and(
          eq(migrationRunRow.workspaceId, actor.workspaceId),
          eq(migrationRunRow.runId, run.id),
          eq(migrationRunRow.state, 'ok'),
        ),
      );
    await tx
      .update(migrationRun)
      .set({ status: 'rolled_back', rolledBackAt: now, updatedAt: now })
      .where(and(eq(migrationRun.workspaceId, actor.workspaceId), eq(migrationRun.id, run.id)));
  });
  deps.log?.('migration.rolled_back', { chunks: done.length });
  return getMigrationProgress(deps, actor, input);
}

/**
 * The workspace's owner, for the staff console to run a migration as (#685). Null when the
 * workspace has no active owner. Read inside the workspace's own scope, so no other tenant's rows
 * are visible.
 */
export async function findMigrationOwner(
  deps: MigrationDeps,
  workspaceId: string,
): Promise<string | null> {
  if (!isUuid(workspaceId)) return null;
  const [owner] = await withWorkspace(deps.db, { workspaceId }, (tx) =>
    tx
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, workspaceId),
          eq(schema.member.role, 'owner'),
          eq(schema.member.status, 'active'),
        ),
      )
      .limit(1),
  );
  return owner?.userId ?? null;
}
