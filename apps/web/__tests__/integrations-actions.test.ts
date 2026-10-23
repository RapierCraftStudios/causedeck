// Integrations server action (#287): `workspaceAction` validates with zod (strict: the kind only),
// rejects non-members, juniors, clerks and viewers (`workspace.manage`) with FORBIDDEN before any
// write, returns NOT_FOUND while the kind's flag is off, and calls the domain service (which stores
// only the new token's hash and records the `workspace.integration_token_rotated` audit event) on
// the workspace-scoped transaction. The full address or URL comes back once, built from APP_URL.
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const TX = { scoped: true };
// Generated per run so no token-shaped literal is committed (gitleaks).
const TOKEN = `tok_${randomBytes(16).toString('hex')}`;
const CREATED = new Date('2026-10-20T10:00:00Z');

interface State {
  session: AppSession | null;
  role: string | null;
  flags: Record<string, boolean>;
}

const state = vi.hoisted((): State => ({
  session: null,
  role: 'owner',
  flags: { 'capture.email-forward': true, 'capture.ics-feed': true },
}));

const core = vi.hoisted(() => ({
  memberRole: vi.fn(() => Promise.resolve(state.role)),
  rotateIntegrationToken: vi.fn(),
}));
const flags = vi.hoisted(() => ({
  isEnabled: vi.fn((key: string) => Promise.resolve(state.flags[key] === true)),
}));

const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
);
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth.ts', () => ({
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../lib/env.ts', () => ({
  serverEnv: () => ({ APP_URL: 'https://app.causedeck.test' }),
}));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/core/workspaces', () => core);
vi.mock('@causedeck/flags/server', () => flags);
vi.mock('next/cache', () => ({ revalidatePath }));

const { rotateIntegrationTokenAction } =
  await import('../app/(app)/w/[slug]/settings/integrations/actions.ts');

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Asha', email: 'a@x.test' },
  } as AppSession;
  state.role = 'owner';
  state.flags = { 'capture.email-forward': true, 'capture.ics-feed': true };
  core.rotateIntegrationToken.mockImplementation((_tx: unknown, request: { kind: string }) =>
    Promise.resolve({ kind: request.kind, token: TOKEN, createdAt: CREATED, rotatedAt: null }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('rotateIntegrationTokenAction', () => {
  it.each([
    ['owner', 'ics_feed', `https://app.causedeck.test/api/ics/${TOKEN}`],
    ['advocate', 'ics_feed', `https://app.causedeck.test/api/ics/${TOKEN}`],
  ])(
    'rotates for an %s on the workspace transaction and returns the %s value once',
    async (role, kind, value) => {
      state.role = role;
      expect(await rotateIntegrationTokenAction({ workspaceId: WS, kind })).toEqual({
        ok: true,
        data: { kind, value, createdAt: CREATED, rotatedAt: null },
      });
      expect(withWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        { workspaceId: WS, userId: USER },
        expect.any(Function),
      );
      expect(core.rotateIntegrationToken).toHaveBeenCalledWith(TX, {
        workspaceId: WS,
        actorUserId: USER,
        kind,
        requestId: expect.any(String) as string,
      });
      expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings', 'layout');
    },
  );

  it.each([['ics_feed', 'capture.ics-feed']])(
    'is NOT_FOUND for %s while %s is off, and writes nothing',
    async (kind, flag) => {
      state.flags[flag] = false;
      expect(await rotateIntegrationTokenAction({ workspaceId: WS, kind })).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
      expect(flags.isEnabled).toHaveBeenCalledWith(flag, { workspaceId: WS, userId: USER });
      expect(core.rotateIntegrationToken).not.toHaveBeenCalled();
    },
  );

  it.each(['junior', 'clerk', 'viewer', null])(
    'returns FORBIDDEN for %s before any write',
    async (role) => {
      state.role = role;
      expect(
        await rotateIntegrationTokenAction({ workspaceId: WS, kind: 'ics_feed' }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(core.rotateIntegrationToken).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown kinds, extra fields and bad input with VALIDATION', async () => {
    for (const bad of [
      { workspaceId: WS, kind: 'webhook' },
      { workspaceId: WS },
      { workspaceId: WS, kind: 'ics_feed', token: 'chosen' },
      { workspaceId: 'not-a-uuid', kind: 'ics_feed' },
    ]) {
      expect(await rotateIntegrationTokenAction(bad)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    expect(core.rotateIntegrationToken).not.toHaveBeenCalled();
  });

  it('is UNAUTHENTICATED when signed out', async () => {
    state.session = null;
    expect(await rotateIntegrationTokenAction({ workspaceId: WS, kind: 'ics_feed' })).toMatchObject(
      { ok: false, error: { code: 'UNAUTHENTICATED' } },
    );
  });

  it('returns a domain FORBIDDEN from the service as FORBIDDEN', async () => {
    core.rotateIntegrationToken.mockRejectedValue(
      Object.assign(new Error('You cannot do that'), { name: 'WorkspaceError', code: 'FORBIDDEN' }),
    );
    expect(await rotateIntegrationTokenAction({ workspaceId: WS, kind: 'ics_feed' })).toMatchObject(
      { ok: false, error: { code: 'FORBIDDEN' } },
    );
  });
});
