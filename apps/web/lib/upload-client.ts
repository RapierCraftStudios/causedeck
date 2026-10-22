// Browser side of `POST /api/uploads` (#217, #436): ask for an upload intent, PUT the file to the
// presigned URL with the signed headers unchanged, then finalize so the server sniffs and hashes
// it. Resolves to the finalized blob id, or a typed failure the caller words for the user:
//   forbidden     403 (not permitted, or a cross-origin request)
//   not_found     404 (not a member of the workspace)
//   too_large     413 (over the kind's size cap)
//   invalid       400 (file type not allowed, or a bad request)
//   rate_limited  429
//   failed        anything else, including the PUT and the network
// Client-safe: no server imports.

export const UPLOADS_PATH = '/api/uploads';

/** Object kinds `/api/uploads` accepts (`OBJECT_KINDS` in @causedeck/storage). */
export type UploadKind = 'document' | 'audio' | 'image' | 'zip';

export type UploadFailure =
  'forbidden' | 'not_found' | 'too_large' | 'invalid' | 'rate_limited' | 'failed';

export type UploadResult = { ok: true; blobId: string } | { ok: false; error: UploadFailure };

interface IntentResponse {
  blobId: string;
  upload: { url: string; method: 'PUT'; headers: Record<string, string> };
}

const FAILURE_BY_STATUS: Readonly<Record<number, UploadFailure>> = {
  400: 'invalid',
  403: 'forbidden',
  404: 'not_found',
  413: 'too_large',
  429: 'rate_limited',
};

function failureOf(response: Response): UploadFailure {
  return FAILURE_BY_STATUS[response.status] ?? 'failed';
}

function postUploads(body: object): Promise<Response> {
  return fetch(UPLOADS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
}

/** Upload `file` into `workspaceId` as `kind` and finalize it. */
export async function uploadFile(
  workspaceId: string,
  file: File,
  kind: UploadKind = 'document',
): Promise<UploadResult> {
  try {
    const intent = await postUploads({
      action: 'intent',
      workspaceId,
      kind,
      filename: file.name,
      size: file.size,
      mime: file.type === '' ? 'application/octet-stream' : file.type,
    });
    if (!intent.ok) return { ok: false, error: failureOf(intent) };
    const { blobId, upload } = (await intent.json()) as IntentResponse;

    const put = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: file,
    });
    if (!put.ok) return { ok: false, error: 'failed' };

    const finalized = await postUploads({ action: 'finalize', workspaceId, blobId });
    if (!finalized.ok) return { ok: false, error: failureOf(finalized) };
    return { ok: true, blobId };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
