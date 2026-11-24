// Token holder for the preview-only ChatGPT plan adapter (#1165). The token file (written by
// `pnpm --filter @causedeck/ai chatgpt-plan:login`) holds the issued client id and the OAuth
// tokens. The access token lives about an hour and is refreshed 5 minutes before it expires with
// the rotating refresh token (about 30 days).
//
// Web and worker are separate processes sharing one file, and a rotated refresh token is single
// use, so refreshes are serialised: one in flight per process, plus an O_EXCL lock file next to the
// token file across processes. The file is re-read inside the lock (another process may already
// have rotated it) and rewritten atomically (tmp file at 0600, fsync, rename): it is never
// truncated in place. Nothing here logs, and error messages never carry tokens or response bodies.
import { randomBytes } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';

import { PlanUnavailableError, ProviderError } from '../errors.ts';
import type { ChatgptPlanTokenSource } from './chatgpt-plan.ts';

export const CHATGPT_PLAN_TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
export const CHATGPT_PLAN_RESOURCE = 'https://api.openai.com/v1';

/** The token file, version 1. */
export interface ChatgptPlanTokenFile {
  version: 1;
  /** The issued `oaiapp_…` client id. */
  clientId: string;
  /** Stable `urn:uuid:` host id sent at registration. */
  extAgentHostId: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  scope: string;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
}

export interface ChatgptPlanTokenStoreConfig {
  /** CHATGPT_PLAN_TOKEN_FILE: an owner-only (0600) file. */
  file: string;
  /** CHATGPT_PLAN_CLIENT_ID: overrides the file's client id. */
  clientId?: string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Refresh this long before expiry; default 5 minutes. */
  refreshSkewMs?: number;
  /** A lock file older than this is stale and removed; default 30 s. */
  lockStaleMs?: number;
  /** Wait at most this long for another process's lock; default 10 s. */
  lockWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Refresh-token failures that only a new sign-in can fix. */
const RENEW_CODES = new Set([
  'invalid_grant',
  'refresh_token_reused',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'token_expired',
  'invalid_client',
  'unauthorized_client',
]);

const errnoCode = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

function isTokenFile(value: unknown): value is ChatgptPlanTokenFile {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    ['clientId', 'extAgentHostId', 'accessToken', 'refreshToken', 'scope', 'expiresAt'].every(
      (k) => typeof v[k] === 'string',
    ) &&
    typeof v.idToken === 'string'
  );
}

/** Read the token file, or null when it does not exist. Throws when it is unreadable or invalid. */
export async function readTokenFile(file: string): Promise<ChatgptPlanTokenFile | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null;
    throw new PlanUnavailableError('token file unreadable');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new PlanUnavailableError('token file invalid');
  }
  if (!isTokenFile(parsed)) throw new PlanUnavailableError('token file invalid');
  return parsed;
}

/** Write the token file atomically: a new 0600 tmp file, fsync, then rename over the target. */
export async function writeTokenFileAtomic(
  file: string,
  contents: ChatgptPlanTokenFile,
): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(contents, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

interface RefreshReply {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  scope?: unknown;
  expires_in?: unknown;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createChatgptPlanTokenStore(
  config: ChatgptPlanTokenStoreConfig,
): ChatgptPlanTokenSource {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  const skew = config.refreshSkewMs ?? 300_000;
  const lockStaleMs = config.lockStaleMs ?? 30_000;
  const lockWaitMs = config.lockWaitMs ?? 10_000;
  const sleep = config.sleep ?? defaultSleep;
  const lockPath = `${config.file}.lock`;

  let current: ChatgptPlanTokenFile | null = null;
  /** The access token the server rejected; never reused. */
  let rejected: string | null = null;
  let inFlight: Promise<string> | null = null;

  const fresh = (t: ChatgptPlanTokenFile): boolean =>
    t.accessToken !== rejected && Date.parse(t.expiresAt) - now().getTime() >= skew;

  async function load(): Promise<ChatgptPlanTokenFile> {
    const t = await readTokenFile(config.file);
    if (t === null) throw new PlanUnavailableError('sign-in needs renewing');
    return t;
  }

  async function acquireLock(): Promise<() => Promise<void>> {
    const started = Date.now();
    for (;;) {
      try {
        const handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(String(process.pid), 'utf8');
        await handle.close();
        return () => unlink(lockPath).catch(() => undefined);
      } catch (error) {
        if (errnoCode(error) !== 'EEXIST') throw error;
      }
      try {
        const { mtimeMs } = await stat(lockPath);
        if (Date.now() - mtimeMs > lockStaleMs) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
      } catch (error) {
        if (errnoCode(error) === 'ENOENT') continue;
        throw error;
      }
      if (Date.now() - started >= lockWaitMs) {
        throw new ProviderError('chatgpt-plan', 'token refresh lock busy', { retryable: true });
      }
      await sleep(100);
    }
  }

  async function exchange(t: ChatgptPlanTokenFile): Promise<ChatgptPlanTokenFile> {
    const clientId = config.clientId ?? t.clientId;
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: t.refreshToken,
      resource: CHATGPT_PLAN_RESOURCE,
    });
    let response: Response;
    try {
      response = await doFetch(CHATGPT_PLAN_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      });
    } catch {
      throw new ProviderError('chatgpt-plan', 'token refresh network error', { retryable: true });
    }
    let body: unknown;
    try {
      body = JSON.parse(await response.text()) as unknown;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const b = (body ?? {}) as { error?: unknown; code?: unknown };
      const code =
        typeof b.error === 'string'
          ? b.error
          : typeof (b.error as { code?: unknown } | undefined)?.code === 'string'
            ? (b.error as { code: string }).code
            : b.code;
      if (typeof code === 'string' && RENEW_CODES.has(code)) {
        throw new PlanUnavailableError('sign-in needs renewing');
      }
      throw new ProviderError(
        'chatgpt-plan',
        `token refresh failed (HTTP ${String(response.status)})`,
        { retryable: response.status >= 500, status: response.status },
      );
    }
    const r = (body ?? {}) as RefreshReply;
    if (typeof r.access_token !== 'string' || r.access_token === '') {
      throw new ProviderError('chatgpt-plan', 'token refresh returned no access token');
    }
    const expiresIn = typeof r.expires_in === 'number' ? r.expires_in : 3_600;
    return {
      ...t,
      clientId,
      accessToken: r.access_token,
      refreshToken: typeof r.refresh_token === 'string' ? r.refresh_token : t.refreshToken,
      idToken: typeof r.id_token === 'string' ? r.id_token : t.idToken,
      scope: typeof r.scope === 'string' ? r.scope : t.scope,
      expiresAt: new Date(now().getTime() + expiresIn * 1_000).toISOString(),
    };
  }

  async function refresh(): Promise<string> {
    const release = await acquireLock();
    try {
      // Another process may have rotated the tokens while this one waited.
      const onDisk = await load();
      if (fresh(onDisk)) {
        current = onDisk;
        return onDisk.accessToken;
      }
      const next = await exchange(onDisk);
      await writeTokenFileAtomic(config.file, next);
      current = next;
      rejected = null;
      return next.accessToken;
    } finally {
      await release();
    }
  }

  return {
    async accessToken(): Promise<string> {
      current ??= await load();
      if (fresh(current)) return current.accessToken;
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    invalidate(): void {
      if (current !== null) rejected = current.accessToken;
    },
  };
}
