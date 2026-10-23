// The outbox uploader (#50): presign -> PUT -> complete through the capture API (#43), one item at
// a time. The sha256 is the idempotency key: the server de-duplicates at `complete` and answers
// with the original capture, so a retry or a double share never creates a second one. Progress
// (`captureId`, `putDone`) is saved after the PUT, so a retry after a dropped connection skips
// straight to `complete`. Failures back off exponentially with jitter, up to 8 attempts; the
// sent bytes are deleted from the device as soon as `complete` succeeds.
import { decryptBytes } from './crypto.ts';
import type { OutboxItem, OutboxStore } from './db.ts';
import { markAttemptFailed, markDeferred, markFailed, markSent, markUploading } from './queue.ts';

export const PRESIGN_PATH = '/api/captures/presign';
export const completePath = (captureId: string) => `/api/captures/${captureId}/complete`;

export type UploadOutcome = 'sent' | 'retry' | 'failed' | 'signed-out' | 'skipped';

export interface UploaderDeps {
  store: OutboxStore;
  key: CryptoKey;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000;

/** Full jitter: a random delay up to `min(max, base * 2^attempts)`. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempts);
  return Math.round(random() * ceiling);
}

const PERMANENT: Readonly<Record<number, string>> = {
  400: 'invalid',
  403: 'forbidden',
  404: 'not_found',
  413: 'too_large',
  415: 'unsupported_type',
};

class StepError extends Error {
  constructor(
    readonly kind: 'retry' | 'permanent' | 'signed-out',
    message: string,
  ) {
    super(message);
  }
}

function checkStatus(response: Response): void {
  if (response.ok) return;
  if (response.status === 401) throw new StepError('signed-out', 'unauthorized');
  const reason = PERMANENT[response.status];
  if (reason !== undefined) throw new StepError('permanent', reason);
  throw new StepError('retry', `http_${String(response.status)}`);
}

interface Presigned {
  captureId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

async function presign(item: OutboxItem, send: typeof fetch): Promise<Presigned> {
  const response = await send(PRESIGN_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      workspaceId: item.workspaceId,
      channel: item.channel,
      filename: item.name,
      mime: item.mime,
      sizeBytes: item.size,
      sha256: item.sha256,
      ...(item.matterHintId === undefined ? {} : { matterHintId: item.matterHintId }),
    }),
  });
  checkStatus(response);
  return (await response.json()) as Presigned;
}

async function put(target: Presigned, bytes: ArrayBuffer, item: OutboxItem, send: typeof fetch) {
  // The browser sets Content-Length from the body; only the signed content type is sent.
  const response = await send(target.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': target.headers['content-type'] ?? item.mime },
    body: new Blob([bytes], { type: item.mime }),
  });
  checkStatus(response);
}

async function complete(item: OutboxItem, captureId: string, send: typeof fetch): Promise<void> {
  const response = await send(completePath(captureId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ workspaceId: item.workspaceId, sha256: item.sha256 }),
  });
  checkStatus(response);
}

/** Upload one item. Never throws: the outcome says what happened and the row is updated. */
export async function uploadItem(item: OutboxItem, deps: UploaderDeps): Promise<UploadOutcome> {
  const { store } = deps;
  const send = deps.fetch ?? fetch.bind(globalThis);
  const now = deps.now ?? Date.now;
  if (item.workspaceId === null || item.state !== 'queued') return 'skipped';
  const claimed = await markUploading(store, item.id);
  if (claimed === undefined) return 'skipped';

  let progress: Partial<OutboxItem> = {};
  try {
    let captureId = claimed.captureId;
    if (captureId === undefined || claimed.putDone !== true) {
      const bytes = await decryptBytes(deps.key, claimed);
      const target = await presign(claimed, send);
      await put(target, bytes, claimed, send);
      captureId = target.captureId;
      progress = { captureId, putDone: true };
      await store.put({ ...claimed, ...progress });
    }
    await complete(claimed, captureId, send);
    await markSent(store, item.id);
    return 'sent';
  } catch (error) {
    if (error instanceof StepError && error.kind === 'permanent') {
      await markFailed(store, item.id, error.message);
      return 'failed';
    }
    if (error instanceof StepError && error.kind === 'signed-out') {
      await markDeferred(store, item.id, 'signed_out');
      return 'signed-out';
    }
    const message = error instanceof StepError ? error.message : 'network';
    const next = now() + backoffMs(claimed.attempts, deps.random);
    const row = await markAttemptFailed(store, item.id, message, next, progress);
    return row?.state === 'failed' ? 'failed' : 'retry';
  }
}
