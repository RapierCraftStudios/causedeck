// Document download URLs (#217; docs/engineering/storage.md). A 60-second presigned GET that
// forces `Content-Disposition: attachment` and the type sniffed at finalize, issued only for a
// finalized, not-infected blob of the caller's own workspace and after the `document.read` check.
// Another workspace's blob, an open intent and an infected file all read as `NOT_FOUND`. Every
// issued URL is audited. `X-Content-Type-Options: nosniff` cannot be set through an S3 presign; the
// storage edge adds it (Caddy, #98) and the memory provider serves it.
import { withWorkspace } from '@causedeck/db';

import { storageAuditSink } from './audit.ts';
import type { ObjectKey } from './keys.ts';
import { DOWNLOAD_URL_TTL_SECONDS } from './provider.ts';
import { loadBlob, blobNotFound, type StorageCtx } from './upload.ts';

export interface DownloadUrl {
  url: string;
  expiresAt: Date;
  /** Headers the response carries; `nosniff` comes from the storage edge on S3. */
  headers: { 'x-content-type-options': 'nosniff' };
}

/** RFC 6266 `attachment` with an ASCII fallback name and the UTF-8 name (RFC 8187). */
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\w.\- ]/g, '_').slice(0, 255) || 'download';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function createDownloadUrl(ctx: StorageCtx, blobId: string): Promise<DownloadUrl> {
  const scope = { workspaceId: ctx.workspaceId, userId: ctx.userId };
  return withWorkspace(ctx.db, scope, async (tx) => {
    const row = await loadBlob(tx, ctx.workspaceId, blobId);
    if (row === null || row.finalizedAt === null || row.scanStatus === 'infected') {
      throw blobNotFound();
    }
    await ctx.authorize('document.read');
    const signed = await ctx.store.presignGet(row.key as ObjectKey, {
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      contentDisposition: attachmentDisposition(row.filename),
      contentType: row.mime,
    });
    await storageAuditSink.write(tx, {
      action: 'document.download_url_issued',
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      blobId: row.id,
      at: ctx.now?.() ?? new Date(),
    });
    return {
      url: signed.url,
      expiresAt: signed.expiresAt,
      headers: { 'x-content-type-options': 'nosniff' },
    };
  });
}
