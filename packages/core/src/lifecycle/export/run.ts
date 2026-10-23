// Build one workspace export (#301): the body of the `export.build` job. The ZIP streams straight
// from the exporters through `archiver`, the workspace envelope encryption and a multipart upload
// (`storeSystemBlobStream`), so a multi-gigabyte workspace exports in bounded memory. Progress and
// `steps` checkpoints are committed as the build goes (each in its own `withWorkspace`
// transaction), so the export page can poll them.
//
// Idempotent: a job that is already ready, failed or expired is skipped. A retry after a crash
// removes any export object a previous attempt left behind (matched by the job's file name) and
// rebuilds the archive: a ZIP stream cannot resume mid-entry. Logs carry ids, counts and sizes
// only, never row or file contents.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import type { Logger } from '@causedeck/observability';
import {
  storeSystemBlobStream,
  type KeyProvider,
  type ObjectKey,
  type ObjectStore,
} from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';

import {
  countExportFiles,
  counted,
  csvRows,
  exportFiles,
  fileBody,
  filePath,
  jsonLines,
  tableRows,
} from './collect.ts';
import {
  buildManifest,
  encodeManifest,
  MANIFEST_PATH,
  README_PATH,
  readmeText,
  type ManifestFile,
} from './manifest.ts';
import { csvPath, dataEntryCount, jsonlPath, planExport } from './plan.ts';
import { createZipWriter } from './zip.ts';

const { blob, exportJob, organization } = schema;

/** How long a ready export stays downloadable. */
export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

/** Progress is written at most this often (plus at every phase change). */
const PROGRESS_INTERVAL_MS = 2000;

export type ExportPhase = 'collecting' | 'files' | 'packaging' | 'ready';

export interface ExportBuildDeps {
  store: ObjectStore;
  keys: KeyProvider;
  now?: () => Date;
}

export interface ExportBuildCtx {
  /** A root client: every checkpoint commits on its own. */
  db: Queryable;
  log: Pick<Logger, 'info' | 'warn'>;
  /** True on the last retry: a failure then marks the export `failed`. */
  finalAttempt?: boolean;
}

export type ExportBuildOutcome = 'built' | 'skipped' | 'missing';

/** The archive's display name; also how a retry finds a previous attempt's object. */
export const exportFilename = (jobId: string) => `causedeck-export-${jobId}.zip`;

interface Progress {
  phase: ExportPhase;
  done: number;
  total: number;
}

export async function runExportBuild(
  ctx: ExportBuildCtx,
  { workspaceId, jobId }: { workspaceId: string; jobId: string },
  deps: ExportBuildDeps,
): Promise<ExportBuildOutcome> {
  const now = deps.now ?? (() => new Date());
  const fields = { workspaceId, exportId: jobId };
  const scoped = <T>(fn: Parameters<typeof withWorkspace<T>>[2]) =>
    withWorkspace(ctx.db, { workspaceId }, fn);

  const job = await scoped(async (tx) => {
    const [row] = await tx
      .select()
      .from(exportJob)
      .where(and(eq(exportJob.id, jobId), eq(exportJob.workspaceId, workspaceId)));
    if (row === undefined || (row.status !== 'queued' && row.status !== 'running')) return row;
    await tx
      .update(exportJob)
      .set({
        status: 'running',
        progress: 0,
        errorCode: null,
        steps: { ...row.steps, phase: 'collecting', startedAt: now().toISOString() },
      })
      .where(eq(exportJob.id, jobId));
    return row;
  });
  if (job === undefined) {
    ctx.log.warn(fields, 'export job not found');
    return 'missing';
  }
  if (job.status !== 'queued' && job.status !== 'running') {
    ctx.log.info({ ...fields, status: job.status }, 'export already finished; skipped');
    return 'skipped';
  }

  const filename = exportFilename(jobId);
  await removeLeftovers(ctx.db, deps.store, workspaceId, filename);

  const plan = planExport(job.scope);
  const base = { db: ctx.db, workspaceId, userId: job.requestedBy, scope: job.scope };
  const workspaceName = await scoped(async (tx) => {
    const [row] = await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, workspaceId));
    return row?.name ?? '';
  });
  const fileTotal = await countExportFiles(base);

  let progress: Progress = {
    phase: 'collecting',
    done: 0,
    total: dataEntryCount(plan) + fileTotal + 1,
  };
  let written = { at: 0, percent: -1, phase: progress.phase };
  const report = async (next: Partial<Progress>, force = false) => {
    progress = { ...progress, ...next };
    const percent = Math.min(99, Math.floor((progress.done / progress.total) * 100));
    const at = Date.now();
    const due =
      force || progress.phase !== written.phase || at - written.at >= PROGRESS_INTERVAL_MS;
    if (!due || (percent === written.percent && progress.phase === written.phase)) return;
    written = { at, percent, phase: progress.phase };
    await scoped((tx) =>
      tx
        .update(exportJob)
        .set({
          progress: percent,
          steps: {
            ...job.steps,
            phase: progress.phase,
            done: progress.done,
            total: progress.total,
          },
        })
        .where(and(eq(exportJob.id, jobId), eq(exportJob.status, 'running'))),
    );
  };

  const createdAt = job.createdAt;
  const zip = createZipWriter({ date: createdAt });
  const storing = storeSystemBlobStream(
    { db: ctx.db, store: deps.store, keys: deps.keys, workspaceId, now },
    { kind: 'export', filename, mime: 'application/zip', body: zip.output },
  );
  // A failed upload must also stop the writer, or `add` would wait on a reader that is gone.
  storing.catch((error: unknown) => {
    zip.abort(error instanceof Error ? error : new Error('export upload failed'));
  });

  const files: ManifestFile[] = [];
  const counts: Record<string, number> = {};
  let fileCount = 0;
  try {
    const readme = new TextEncoder().encode(
      readmeText({ workspaceName, createdAt: createdAt.toISOString(), scope: job.scope }),
    );
    files.push(await zip.add(README_PATH, readme));
    await report({ done: 1 });

    for (const { table, exporter, csv } of plan.tables) {
      let rows = 0;
      const entry = await zip.add(
        jsonlPath(table),
        jsonLines(counted(tableRows(exporter, base, table), (n) => (rows = n))),
      );
      counts[table] = rows;
      files.push({ ...entry, rows });
      await report({ done: progress.done + 1 });
      if (csv) {
        const csvEntry = await zip.add(csvPath(table), csvRows(tableRows(exporter, base, table)));
        files.push({ ...csvEntry, rows });
        await report({ done: progress.done + 1 });
      }
    }

    await report({ phase: 'files' }, true);
    for await (const file of exportFiles(base)) {
      const body = await fileBody(
        { db: ctx.db, store: deps.store, keys: deps.keys },
        workspaceId,
        file,
      );
      files.push(await zip.add(filePath(file), body));
      fileCount += 1;
      await report({ done: progress.done + 1 });
    }

    await report({ phase: 'packaging' }, true);
    const manifest = buildManifest({
      exportId: jobId,
      workspaceId,
      scope: job.scope,
      createdAt: createdAt.toISOString(),
      counts,
      fileCount,
      excluded: plan.excluded,
      files,
    });
    await zip.add(MANIFEST_PATH, encodeManifest(manifest));
    await zip.finish();
  } catch (error) {
    zip.abort(error instanceof Error ? error : new Error('export build failed'));
    await storing.catch(() => undefined);
    await markFailure(ctx, scoped, jobId, error);
    throw error;
  }

  let stored: Awaited<typeof storing>;
  try {
    stored = await storing;
  } catch (error) {
    await markFailure(ctx, scoped, jobId, error);
    throw error;
  }

  const completedAt = now();
  const expiresAt = new Date(completedAt.getTime() + EXPORT_TTL_MS);
  const marked = await scoped((tx) =>
    tx
      .update(exportJob)
      .set({
        status: 'ready',
        progress: 100,
        blobId: stored.blobId,
        sizeBytes: stored.size,
        sha256: stored.sha256,
        completedAt,
        expiresAt,
        errorCode: null,
        steps: {
          ...job.steps,
          phase: 'ready',
          done: progress.total,
          total: progress.total,
          tables: plan.tables.length,
          files: fileCount,
        },
      })
      .where(and(eq(exportJob.id, jobId), eq(exportJob.status, 'running')))
      .returning({ id: exportJob.id }),
  );
  if (marked.length === 0) {
    // Cancelled or expired meanwhile: keep nothing.
    await removeLeftovers(ctx.db, deps.store, workspaceId, filename);
    return 'skipped';
  }
  ctx.log.info(
    { ...fields, tables: plan.tables.length, files: fileCount, sizeBytes: stored.size },
    'export ready',
  );
  return 'built';
}

/** Delete export objects and rows a previous attempt of this job left behind. */
async function removeLeftovers(
  db: Queryable,
  store: ObjectStore,
  workspaceId: string,
  filename: string,
): Promise<void> {
  const rows = await withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .delete(blob)
      .where(
        and(
          eq(blob.workspaceId, workspaceId),
          eq(blob.kind, 'export'),
          eq(blob.filename, filename),
        ),
      )
      .returning({ key: blob.key }),
  );
  for (const row of rows) await store.delete(row.key as ObjectKey);
}

/** A stable, content-free code for the export row (`error_code`). */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)) return code;
  const name = error instanceof Error ? error.name : 'NonError';
  return /^\w{1,64}$/.test(name) ? name : 'EXPORT_FAILED';
}

async function markFailure(
  ctx: ExportBuildCtx,
  scoped: <T>(fn: Parameters<typeof withWorkspace<T>>[2]) => Promise<T>,
  jobId: string,
  error: unknown,
): Promise<void> {
  const code = errorCode(error);
  ctx.log.warn(
    { exportId: jobId, errorCode: code, final: ctx.finalAttempt ?? false },
    'export build failed',
  );
  await scoped((tx) =>
    tx
      .update(exportJob)
      .set(
        ctx.finalAttempt
          ? { status: 'failed', errorCode: code, completedAt: new Date() }
          : { errorCode: code },
      )
      .where(and(eq(exportJob.id, jobId), eq(exportJob.status, 'running'))),
  ).catch(() => undefined);
}
