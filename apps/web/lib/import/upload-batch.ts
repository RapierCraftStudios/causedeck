// Browser side of the bootstrap import upload (#552): each file goes through the capture upload
// flow on the `bulk_import` channel (`POST /api/captures/presign`, a PUT to the presigned URL,
// `POST /api/captures/:id/complete`). Resolves to the capture id or a typed failure the caller words
// for the user. Client-safe: no server imports.
import type { UploadFailureCode } from './file-rules.ts';

export type UploadOutcome =
  { ok: true; captureId: string; duplicate: boolean } | { ok: false; error: UploadFailureCode };

function post(path: string, body: object): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
}

async function failureOf(response: Response): Promise<UploadFailureCode> {
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (body.error === 'channel_disabled') return 'channel_disabled';
  if (body.error === 'sensitive_matter_excluded') return 'sensitive';
  if (response.status === 413) return 'too_large';
  if (response.status === 415) return 'unsupported';
  if (response.status === 429) return 'rate_limited';
  if (response.status === 403) return 'forbidden';
  return 'failed';
}

/** Upload one file as a `bulk_import` capture of `workspaceId`. */
export async function uploadImportFile(
  workspaceId: string,
  file: File,
  sha256: string,
): Promise<UploadOutcome> {
  try {
    const presign = await post('/api/captures/presign', {
      workspaceId,
      channel: 'bulk_import',
      filename: file.name,
      mime: file.type === '' ? 'application/octet-stream' : file.type,
      sizeBytes: file.size,
      sha256,
    });
    if (!presign.ok) return { ok: false, error: await failureOf(presign) };
    const intent = (await presign.json()) as {
      captureId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };
    const put = await fetch(intent.uploadUrl, {
      method: 'PUT',
      headers: intent.headers,
      body: file,
    });
    if (!put.ok) return { ok: false, error: 'failed' };
    const complete = await post(`/api/captures/${intent.captureId}/complete`, {
      workspaceId,
      sha256,
    });
    if (!complete.ok) return { ok: false, error: await failureOf(complete) };
    const done = (await complete.json()) as { status?: string };
    return { ok: true, captureId: intent.captureId, duplicate: done.status === 'duplicate' };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

/** Run `task` over `items` with at most `limit` in flight. */
export async function runLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++] as T;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
