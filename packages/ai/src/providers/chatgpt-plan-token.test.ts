import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanUnavailableError } from '../errors.ts';
import {
  CHATGPT_PLAN_TOKEN_URL,
  createChatgptPlanTokenStore,
  type ChatgptPlanTokenFile,
} from './chatgpt-plan-token.ts';

const OLD_ACCESS = 'old-access-SECRET-1';
const OLD_REFRESH = 'old-refresh-SECRET-2';
const NEW_ACCESS = 'new-access-SECRET-3';
const NEW_REFRESH = 'new-refresh-SECRET-4';
const T0 = Date.parse('2026-11-24T10:00:00.000Z');

let dir: string;
let file: string;
let clock: number;
const now = (): Date => new Date(clock);

function seed(expiresAt: number, over: Partial<ChatgptPlanTokenFile> = {}): void {
  const contents: ChatgptPlanTokenFile = {
    version: 1,
    clientId: 'oaiapp_test',
    extAgentHostId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
    accessToken: OLD_ACCESS,
    refreshToken: OLD_REFRESH,
    idToken: 'id.token.x',
    scope: 'openid offline_access chatgpt.tokens.use.direct',
    expiresAt: new Date(expiresAt).toISOString(),
    ...over,
  };
  writeFileSync(file, JSON.stringify(contents), { mode: 0o600 });
}

const readFile = (): ChatgptPlanTokenFile =>
  JSON.parse(readFileSync(file, 'utf8')) as ChatgptPlanTokenFile;

function refreshOk() {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          access_token: NEW_ACCESS,
          refresh_token: NEW_REFRESH,
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200 },
      ),
    ),
  );
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'chatgpt-plan-token-'));
  file = path.join(dir, 'tokens.json');
  clock = T0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('chatgpt-plan token store', () => {
  it('does not refresh while the access token is fresh', async () => {
    seed(T0 + 60 * 60_000);
    const f = refreshOk();
    const store = createChatgptPlanTokenStore({ file, fetch: f, now });
    await expect(store.accessToken()).resolves.toBe(OLD_ACCESS);
    clock = T0 + 54 * 60_000; // 6 min before expiry
    await expect(store.accessToken()).resolves.toBe(OLD_ACCESS);
    expect(f).not.toHaveBeenCalled();
  });

  it('refreshes 5 minutes before expiry with the refresh-token form body', async () => {
    seed(T0 + 60 * 60_000);
    const f = refreshOk();
    const store = createChatgptPlanTokenStore({ file, fetch: f, now });
    await store.accessToken();
    clock = T0 + 55 * 60_000 + 1; // just under 5 min left
    await expect(store.accessToken()).resolves.toBe(NEW_ACCESS);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(CHATGPT_PLAN_TOKEN_URL);
    expect(url).toBe('https://auth.openai.com/api/accounts/oauth/token');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const form = new URLSearchParams(init?.body as string);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'refresh_token',
      client_id: 'oaiapp_test',
      refresh_token: OLD_REFRESH,
      resource: 'https://api.openai.com/v1',
    });
  });

  it('uses the configured client id over the file', async () => {
    seed(T0);
    const f = refreshOk();
    const store = createChatgptPlanTokenStore({ file, clientId: 'oaiapp_env', fetch: f, now });
    await store.accessToken();
    expect(new URLSearchParams(f.mock.calls[0]?.[1]?.body as string).get('client_id')).toBe(
      'oaiapp_env',
    );
    expect(readFile().clientId).toBe('oaiapp_env');
  });

  it('persists the rotated refresh token atomically at 0600 via tmp and rename', async () => {
    seed(T0 - 1);
    const inodeBefore = statSync(file).ino;
    const store = createChatgptPlanTokenStore({ file, fetch: refreshOk(), now });
    await store.accessToken();
    const saved = readFile();
    expect(saved).toMatchObject({
      accessToken: NEW_ACCESS,
      refreshToken: NEW_REFRESH,
      extAgentHostId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      expiresAt: new Date(T0 + 3_600_000).toISOString(),
    });
    const st = statSync(file);
    expect(st.mode & 0o777).toBe(0o600);
    // A new inode: the file was replaced by rename, never truncated and rewritten in place.
    expect(st.ino).not.toBe(inodeBefore);
    expect(readdirSync(dir).sort()).toEqual(['tokens.json']);
  });

  it('two concurrent callers share one refresh', async () => {
    seed(T0 - 1);
    const f = refreshOk();
    const store = createChatgptPlanTokenStore({ file, fetch: f, now });
    const [a, b] = await Promise.all([store.accessToken(), store.accessToken()]);
    expect(a).toBe(NEW_ACCESS);
    expect(b).toBe(NEW_ACCESS);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('skips the refresh when another process already rotated the file', async () => {
    seed(T0 + 60 * 60_000);
    const f = refreshOk();
    const store = createChatgptPlanTokenStore({ file, fetch: f, now });
    await store.accessToken();
    // Another process rotates the tokens on disk.
    seed(T0 + 120 * 60_000, { accessToken: 'other-process-access', refreshToken: 'r2' });
    clock = T0 + 58 * 60_000;
    await expect(store.accessToken()).resolves.toBe('other-process-access');
    expect(f).not.toHaveBeenCalled();
  });

  it('refreshes after invalidate() even while the token looks fresh', async () => {
    seed(T0 + 60 * 60_000);
    const f = refreshOk();
    const store = createChatgptPlanTokenStore({ file, fetch: f, now });
    await store.accessToken();
    store.invalidate();
    await expect(store.accessToken()).resolves.toBe(NEW_ACCESS);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('removes a stale lock left by a crashed process', async () => {
    seed(T0 - 1);
    writeFileSync(`${file}.lock`, '1');
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${file}.lock`, old, old);
    const store = createChatgptPlanTokenStore({ file, fetch: refreshOk(), now });
    await expect(store.accessToken()).resolves.toBe(NEW_ACCESS);
    expect(readdirSync(dir)).not.toContain('tokens.json.lock');
  });

  it('gives up with a retryable error while another process holds a live lock', async () => {
    seed(T0 - 1);
    writeFileSync(`${file}.lock`, '1');
    const f = refreshOk();
    const sleep = vi.fn(() => Promise.resolve());
    const store = createChatgptPlanTokenStore({ file, fetch: f, now, lockWaitMs: 0, sleep });
    await expect(store.accessToken()).rejects.toMatchObject({ retryable: true });
    expect(f).not.toHaveBeenCalled();
  });

  it('a refused refresh is PlanUnavailableError with no token in the message or logs', async () => {
    seed(T0 - 1);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const f = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'refresh_token_reused',
            error_description: `token ${OLD_REFRESH} was reused (access ${OLD_ACCESS})`,
          }),
          { status: 400 },
        ),
      ),
    );
    const store = createChatgptPlanTokenStore({ file, fetch: f, now });
    const error = (await store.accessToken().catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(PlanUnavailableError);
    expect(error.message).toContain('sign-in needs renewing');
    for (const secret of [OLD_ACCESS, OLD_REFRESH]) {
      expect(error.message).not.toContain(secret);
      expect(String(error.stack)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // The file is never cleared on a refused refresh.
    expect(readFile().refreshToken).toBe(OLD_REFRESH);
  });

  it('a 5xx refresh failure carries only the status', async () => {
    seed(T0 - 1);
    const f = vi.fn(() =>
      Promise.resolve(new Response(`upstream echoed ${OLD_REFRESH}`, { status: 502 })),
    );
    const store = createChatgptPlanTokenStore({ file, fetch: f, now });
    const error = (await store.accessToken().catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('HTTP 502');
    expect(error.message).not.toContain(OLD_REFRESH);
  });

  it('a missing token file is PlanUnavailableError', async () => {
    const store = createChatgptPlanTokenStore({ file, fetch: refreshOk(), now });
    await expect(store.accessToken()).rejects.toBeInstanceOf(PlanUnavailableError);
  });
});
