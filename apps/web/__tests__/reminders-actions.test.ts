// Court-day reminder preference actions (#64): `workspaceAction` guards, the service is called on
// the workspace-scoped transaction for the signed-in user only, and a bad time or channel is refused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const OTHER = '00000000-0000-4000-8000-0000000b0102';
const TX = { scoped: true };
const state = vi.hoisted((): { session: AppSession | null; role: string | null } => ({
  session: null,
  role: 'junior',
}));

class NotificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const service = vi.hoisted(
  (): {
    getReminderPreferences: ReturnType<typeof vi.fn>;
    setReminderPreferences: ReturnType<typeof vi.fn>;
    NotificationError?: unknown;
  } => ({ getReminderPreferences: vi.fn(), setReminderPreferences: vi.fn() }),
);
service.NotificationError = NotificationError;
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
vi.mock('@causedeck/core/workspaces', () => ({ memberRole: () => Promise.resolve(state.role) }));
vi.mock('@causedeck/notifications', () => service);

const actions = await import('../app/(app)/w/[slug]/settings/notifications/reminders-actions.ts');

const channels = { in_app: true, push: false, email: true };
const view = {
  evening: { enabled: true, time: '20:00', channels },
  morning: { enabled: true, time: '07:00', channels },
  outcome_missing: { enabled: true, delayMinutes: 90, channels },
};

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

describe('reminder preference actions', () => {
  it('rejects a non-member and a signed-out caller before the service', async () => {
    state.role = null;
    expect(await actions.getReminderPreferencesAction({ workspaceId: WS })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    state.session = null;
    expect(await actions.getReminderPreferencesAction({ workspaceId: WS })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(service.getReminderPreferences).not.toHaveBeenCalled();
  });

  it('reads the signed-in member’s preferences on the workspace transaction', async () => {
    service.getReminderPreferences.mockResolvedValue(view);
    const result = await actions.getReminderPreferencesAction({ workspaceId: WS, userId: OTHER });
    expect(result).toEqual({ ok: true, data: view });
    expect(service.getReminderPreferences).toHaveBeenCalledWith(
      { db: TX, workspaceId: WS },
      { userId: USER },
    );
  });

  it('saves for the signed-in member, never the user named in the input', async () => {
    service.setReminderPreferences.mockResolvedValue(view);
    const result = await actions.setReminderPreferencesAction({
      workspaceId: WS,
      userId: OTHER,
      evening: { time: '21:00', channels },
      morning: { channels },
      outcome_missing: { delayMinutes: 60, channels },
    });
    expect(result).toEqual({ ok: true, data: view });
    expect(service.setReminderPreferences).toHaveBeenCalledWith(
      { db: TX, workspaceId: WS },
      expect.objectContaining({ userId: USER, evening: { time: '21:00', channels } }),
    );
  });

  it('refuses a malformed channel set and maps a service VALIDATION', async () => {
    expect(
      await actions.setReminderPreferencesAction({
        workspaceId: WS,
        evening: { channels: { in_app: true } },
        morning: { channels },
        outcome_missing: { channels },
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(service.setReminderPreferences).not.toHaveBeenCalled();
    service.setReminderPreferences.mockRejectedValue(
      new NotificationError('VALIDATION', 'time must be HH:00 or HH:30 between 18:00 and 23:00'),
    );
    expect(
      await actions.setReminderPreferencesAction({
        workspaceId: WS,
        evening: { time: '03:00', channels },
        morning: { channels },
        outcome_missing: { channels },
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
