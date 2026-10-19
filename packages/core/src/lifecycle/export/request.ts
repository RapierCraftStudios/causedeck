// Export requests and downloads (#301; docs/engineering/data-lifecycle.md).
//
// - `requestExport`: owners only. One export in flight per requester and workspace (a second
//   request returns the running one). Records `export.requested` (fail-closed) in the same
//   transaction, then enqueues `export.build` with ids only.
// - `getExportJob` / `listExportJobs`: the requester's own exports in the current workspace; row-
//   level security keeps every other workspace's rows out.
// - `issueExportDownload`: a download link for a ready export, for its requester only. The token
//   is `base64url(payload) "." base64url(HMAC-SHA256)` over the export, requester, workspace,
//   expiry and a 256-bit random nonce. Only the nonce's sha256 is stored on the job, so issuing a
//   new link revokes the old one, and a token cannot be guessed (>= 128 bits) or forged.
// - `openExportDownload`: checks the signature, the session user, expiry and the stored nonce
//   hash, records `export.downloaded` before the first byte, and streams the decrypted ZIP.
// Export contents never reach a log or an audit event; nothing is sent to a third party.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import type { ExportScope, ExportStatus } from '@causedeck/db/schema';
import {
  decryptForWorkspace,
  type KeyProvider,
  type ObjectKey,
  type ObjectStore,
} from '@causedeck/storage';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { record } from '../../audit/writer.ts';
import { enqueueExportBuild } from '../../jobs/definitions/export-build.ts';
import { notFound } from '../../workspaces/errors.ts';
import { requireOwner } from '../../workspaces/members.ts';

const { blob, exportJob } = schema;

/** Download tokens carry this many random bytes (256 bits). */
export const EXPORT_TOKEN_NONCE_BYTES = 32;

/** Exports shown in the history. */
export const EXPORT_HISTORY_LIMIT = 5;

export interface ExportJob {
  id: string;
  workspaceId: string;
  requestedBy: string;
  scope: ExportScope;
  status: ExportStatus;
  progress: number;
  /** Phase of a running build: `collecting`, `files`, `packaging` or `ready`. */
  phase: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

export interface ExportRequestCtx {
  db: Queryable;
  workspaceId: string;
  userId: string;
  requestId?: string;
  userAgent?: string;
  ip?: string;
  now?: () => Date;
}

type Row = typeof exportJob.$inferSelect;

function toJob(row: Row): ExportJob {
  const phase = row.steps.phase;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    requestedBy: row.requestedBy,
    scope: row.scope,
    status: row.status,
    progress: row.progress,
    phase: typeof phase === 'string' ? phase : null,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
  };
}

const scopeOf = (ctx: ExportRequestCtx) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId });

const auditCtx = (ctx: ExportRequestCtx, db: Queryable) => ({
  db,
  workspaceId: ctx.workspaceId,
  actor: { userId: ctx.userId, kind: 'user' as const },
  ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
  ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
  ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
});

export interface RequestExportDeps {
  /** Enqueue `export.build`; defaults to the job producer. */
  enqueue?: (job: { workspaceId: string; jobId: string }) => Promise<unknown>;
}

/** Request an export of the current workspace (`workspace`) or of the requester's own records. */
export async function requestExport(
  ctx: ExportRequestCtx,
  { scope }: { scope: ExportScope },
  deps: RequestExportDeps = {},
): Promise<ExportJob> {
  // Callers outside TypeScript (server actions parse input) could still pass anything.
  if (!(['workspace', 'user'] as string[]).includes(scope)) {
    throw new TypeError('requestExport: bad scope');
  }
  const { job, created } = await withWorkspace(ctx.db, scopeOf(ctx), async (tx) => {
    await requireOwner(tx, ctx.workspaceId, ctx.userId);
    const [active] = await tx
      .select()
      .from(exportJob)
      .where(
        and(
          eq(exportJob.workspaceId, ctx.workspaceId),
          eq(exportJob.requestedBy, ctx.userId),
          inArray(exportJob.status, ['queued', 'running']),
        ),
      )
      .limit(1);
    if (active !== undefined) return { job: active, created: false };
    const [row] = await tx
      .insert(exportJob)
      .values({
        workspaceId: ctx.workspaceId,
        requestedBy: ctx.userId,
        scope,
        ...(ctx.now ? { createdAt: ctx.now() } : {}),
      })
      .returning();
    if (row === undefined) throw new Error('requestExport: insert returned no row');
    await record(auditCtx(ctx, tx), {
      action: 'export.requested',
      target: { kind: 'export_job', id: row.id },
      metadata: { scope },
    });
    return { job: row, created: true };
  });
  if (created) {
    const enqueue = deps.enqueue ?? enqueueExportBuild;
    await enqueue({ workspaceId: ctx.workspaceId, jobId: job.id });
  }
  return toJob(job);
}

/** One of the requester's exports in the current workspace; `null` otherwise. */
export async function getExportJob(
  ctx: ExportRequestCtx,
  jobId: string,
): Promise<ExportJob | null> {
  if (!z.uuid().safeParse(jobId).success) return null;
  const [row] = await withWorkspace(ctx.db, scopeOf(ctx), (tx) =>
    tx
      .select()
      .from(exportJob)
      .where(
        and(
          eq(exportJob.id, jobId),
          eq(exportJob.workspaceId, ctx.workspaceId),
          eq(exportJob.requestedBy, ctx.userId),
        ),
      ),
  );
  return row === undefined ? null : toJob(row);
}

/** The requester's latest exports in the current workspace, newest first. */
export async function listExportJobs(ctx: ExportRequestCtx): Promise<ExportJob[]> {
  const rows = await withWorkspace(ctx.db, scopeOf(ctx), (tx) =>
    tx
      .select()
      .from(exportJob)
      .where(and(eq(exportJob.workspaceId, ctx.workspaceId), eq(exportJob.requestedBy, ctx.userId)))
      .orderBy(desc(exportJob.createdAt))
      .limit(EXPORT_HISTORY_LIMIT),
  );
  return rows.map(toJob);
}

const tokenPayload = z
  .object({
    /** Export job id. */
    j: z.uuid(),
    /** Workspace id. */
    w: z.uuid(),
    /** Requester's user id. */
    u: z.uuid(),
    /** Expiry, epoch milliseconds. */
    exp: z.number().int().positive(),
    /** base64url random nonce. */
    n: z.string().min(43).max(64),
  })
  .strict();

export type ExportTokenPayload = z.infer<typeof tokenPayload>;

/** A key for export links only, derived from the server secret. */
const tokenKey = (secret: string) =>
  createHmac('sha256', secret).update('causedeck:export-download:v1').digest();

const sign = (body: string, secret: string) =>
  createHmac('sha256', tokenKey(secret)).update(body).digest('base64url');

const nonceHash = (nonce: string) => createHash('sha256').update(nonce).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Decode and check the signature and shape of a token; `null` when either fails. */
export function readExportToken(token: string, secret: string): ExportTokenPayload | null {
  const [body, mac, extra] = token.split('.');
  if (body === undefined || mac === undefined || extra !== undefined) return null;
  if (!safeEqual(mac, sign(body, secret))) return null;
  try {
    const parsed = tokenPayload.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface ExportDownloadLink {
  token: string;
  expiresAt: Date;
}

const missing = () => notFound('Export not found');

/** The requester's ready, unexpired export, locked for update; `NOT_FOUND` otherwise. */
async function readyJob(tx: Queryable, ctx: ExportRequestCtx, jobId: string, now: Date) {
  if (!z.uuid().safeParse(jobId).success) throw missing();
  const [row] = await tx
    .select()
    .from(exportJob)
    .where(and(eq(exportJob.id, jobId), eq(exportJob.workspaceId, ctx.workspaceId)))
    .for('update');
  if (
    row === undefined ||
    row.requestedBy !== ctx.userId ||
    row.status !== 'ready' ||
    row.expiresAt === null ||
    row.expiresAt <= now ||
    row.blobId === null
  ) {
    throw missing();
  }
  return { ...row, blobId: row.blobId, expiresAt: row.expiresAt };
}

/**
 * Issue a download link for the requester's ready export (owners only), valid until the export
 * expires. Issuing a new link revokes the previous one.
 */
export async function issueExportDownload(
  ctx: ExportRequestCtx,
  jobId: string,
  { secret }: { secret: string },
): Promise<ExportDownloadLink> {
  const now = ctx.now?.() ?? new Date();
  return withWorkspace(ctx.db, scopeOf(ctx), async (tx) => {
    await requireOwner(tx, ctx.workspaceId, ctx.userId);
    const job = await readyJob(tx, ctx, jobId, now);
    const nonce = randomBytes(EXPORT_TOKEN_NONCE_BYTES).toString('base64url');
    await tx
      .update(exportJob)
      .set({ downloadTokenHash: nonceHash(nonce) })
      .where(eq(exportJob.id, job.id));
    await record(auditCtx(ctx, tx), {
      action: 'export.download_link_issued',
      target: { kind: 'export_job', id: job.id },
    });
    const payload: ExportTokenPayload = {
      j: job.id,
      w: ctx.workspaceId,
      u: ctx.userId,
      exp: job.expiresAt.getTime(),
      n: nonce,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { token: `${body}.${sign(body, secret)}`, expiresAt: job.expiresAt };
  });
}

export interface ExportDownload {
  filename: string;
  sizeBytes: number;
  sha256: string;
  body: AsyncIterable<Uint8Array>;
}

export interface ExportDownloadDeps {
  store: ObjectStore;
  keys: KeyProvider;
  secret: string;
}

/**
 * Open the requester's export for download: `ctx.userId` must be the requester named in a valid,
 * unexpired token for this export and the token's nonce must be the current one. Anything else is
 * `NOT_FOUND`. `export.downloaded` is recorded before the stream starts.
 */
export async function openExportDownload(
  ctx: ExportRequestCtx,
  jobId: string,
  token: string,
  deps: ExportDownloadDeps,
): Promise<ExportDownload> {
  const now = ctx.now?.() ?? new Date();
  const payload = readExportToken(token, deps.secret);
  if (
    payload === null ||
    payload.j !== jobId ||
    payload.w !== ctx.workspaceId ||
    payload.u !== ctx.userId ||
    payload.exp <= now.getTime()
  ) {
    throw missing();
  }
  const file = await withWorkspace(ctx.db, scopeOf(ctx), async (tx) => {
    await requireOwner(tx, ctx.workspaceId, ctx.userId);
    const job = await readyJob(tx, ctx, jobId, now);
    if (job.downloadTokenHash === null || !safeEqual(job.downloadTokenHash, nonceHash(payload.n))) {
      throw missing();
    }
    const [row] = await tx
      .select({ key: blob.key, filename: blob.filename })
      .from(blob)
      .where(and(eq(blob.id, job.blobId), eq(blob.workspaceId, ctx.workspaceId)));
    if (row === undefined) throw missing();
    await record(auditCtx(ctx, tx), {
      action: 'export.downloaded',
      target: { kind: 'export_job', id: job.id },
    });
    return {
      key: row.key,
      filename: row.filename,
      sizeBytes: job.sizeBytes ?? 0,
      sha256: job.sha256 ?? '',
    };
  });
  const { body } = await deps.store.getStream(file.key as ObjectKey);
  return {
    filename: file.filename,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    body: decryptForWorkspace(ctx.db, deps.keys, ctx.workspaceId, body),
  };
}
