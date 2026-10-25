// Notification preferences server actions (#199): each runs through `workspaceAction` (zod,
// `requireSession`, membership), calls the notifications service on the workspace-scoped
// transaction for the signed-in user only, and maps `NotificationError` to the matching action
// error (a mandatory channel cannot be turned off).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const OTHER = '00000000-0000-4000-8000-0000000b0102';
const TX = { scoped: true };

interface State {
  session: AppSession | null;
  role: string | null;
}

const state = vi.hoisted((): State => ({ session: null, role: 'junior' }));

class NotificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NotificationError';
  }
}

interface FakeService {
  setPreference: ReturnType<typeof vi.fn>;
  setDigest: ReturnType<typeof vi.fn>;
  setCourtHoursQuiet: ReturnType<typeof vi.fn>;
  setLockScreenDetails: ReturnType<typeof vi.fn>;
  NotificationError?: typeof NotificationError;
}

const service = vi.hoisted((): FakeService => ({
  setPreference: vi.fn(),
  setDigest: vi.fn(),
  setCourtHoursQuiet: vi.fn(),
  setLockScreenDetails: vi.fn(),
}));

const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
);

vi.mock('../lib/auth.ts', () => ({
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/core/workspaces', () => ({
  memberRole: () => Promise.resolve(state.role),
}));
vi.mock('@causedeck/notifications', () => service);

service.NotificationError = NotificationError;

const actions = await import('../app/(app)/w/[slug]/settings/notifications/actions.ts');

const ctx = { db: TX, workspaceId: WS };

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Asha', email: 'a@x.test' },
  } as AppSession;
  state.role = 'junior';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('guards', () => {
  it('rejects a non-member with FORBIDDEN before any service call', async () => {
    state.role = null;
    const result = await actions.setNotificationDigestAction({ workspaceId: WS, digest: 'daily' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(service.setDigest).not.toHaveBeenCalled();
    expect(withWorkspace).not.toHaveBeenCalled();
  });

  it('rejects a signed-out caller as UNAUTHENTICATED', async () => {
    state.session = null;
    const result = await actions.setCourtHoursQuietAction({ workspaceId: WS, enabled: true });
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('validates input: unknown category, channel or digest, and no userId', async () => {
    for (const [action, input] of [
      [
        actions.setNotificationPreferenceAction,
        { workspaceId: WS, category: 'party.gossip', channel: 'email', enabled: false },
      ],
      [
        actions.setNotificationPreferenceAction,
        { workspaceId: WS, category: 'reminder.hearing', channel: 'sms', enabled: false },
      ],
      [actions.setNotificationDigestAction, { workspaceId: WS, digest: 'weekly' }],
      [actions.setLockScreenDetailsAction, { workspaceId: WS, enabled: 'yes' }],
    ] as const) {
      expect(await action(input), JSON.stringify(input)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    expect(service.setPreference).not.toHaveBeenCalled();
    expect(service.setDigest).not.toHaveBeenCalled();
  });
});

describe('actions', () => {
  it('sets one category/channel for the signed-in user on the workspace transaction', async () => {
    const view = {
      category: 'reminder.hearing',
      channel: 'email',
      enabled: false,
      digest: 'instant',
      locked: false,
    };
    service.setPreference.mockResolvedValue(view);
    const result = await actions.setNotificationPreferenceAction({
      workspaceId: WS,
      category: 'reminder.hearing',
      channel: 'email',
      enabled: false,
      userId: OTHER,
    });
    expect(result).toEqual({ ok: true, data: view });
    expect(withWorkspace).toHaveBeenCalledWith(
      { fake: 'db' },
      { workspaceId: WS, userId: USER },
      expect.any(Function),
    );
    expect(service.setPreference).toHaveBeenCalledWith(ctx, {
      userId: USER,
      category: 'reminder.hearing',
      channel: 'email',
      enabled: false,
    });
  });

  it('returns the service VALIDATION when a mandatory channel is turned off', async () => {
    service.setPreference.mockRejectedValue(
      new NotificationError('VALIDATION', 'security.alert cannot be turned off for email'),
    );
    const result = await actions.setNotificationPreferenceAction({
      workspaceId: WS,
      category: 'security.alert',
      channel: 'email',
      enabled: false,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('sets the digest, court hours and lock-screen details for the signed-in user', async () => {
    service.setDigest.mockResolvedValue('daily');
    expect(await actions.setNotificationDigestAction({ workspaceId: WS, digest: 'daily' })).toEqual(
      {
        ok: true,
        data: { digest: 'daily' },
      },
    );
    expect(service.setDigest).toHaveBeenCalledWith(ctx, { userId: USER, digest: 'daily' });

    const settings = { courtHoursQuiet: true, lockScreenDetails: false };
    service.setCourtHoursQuiet.mockResolvedValue(settings);
    expect(await actions.setCourtHoursQuietAction({ workspaceId: WS, enabled: true })).toEqual({
      ok: true,
      data: settings,
    });
    expect(service.setCourtHoursQuiet).toHaveBeenCalledWith(ctx, { userId: USER, enabled: true });

    service.setLockScreenDetails.mockResolvedValue({ ...settings, lockScreenDetails: true });
    await actions.setLockScreenDetailsAction({ workspaceId: WS, enabled: true });
    expect(service.setLockScreenDetails).toHaveBeenCalledWith(ctx, { userId: USER, enabled: true });
  });

  it('hides an unexpected failure as INTERNAL', async () => {
    service.setDigest.mockRejectedValue(new Error('connection reset to db.internal'));
    const result = await actions.setNotificationDigestAction({ workspaceId: WS, digest: 'off' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(result)).not.toContain('db.internal');
  });
});
