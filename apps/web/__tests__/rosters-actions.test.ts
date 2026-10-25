// Roster server actions (#434): preview and confirm need `workspace.manage` (owners and
// advocates), so juniors, clerks and viewers are FORBIDDEN before any runtime call; dismiss needs
// `matter.write`. Preview reads the upload through `previewRosterImportFor` with the app's object
// store; confirm runs `confirmRosterImportFor` (confirm, then bench-change detection) and refreshes
// the rosters page; dismiss runs `dismissAlert` on the workspace transaction. Another workspace's
// blob, forum or alert comes back from core as NOT_FOUND.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const BLOB = '00000000-0000-4000-8000-0000000c0001';
const FORUM = '00000000-0000-4000-8000-0000000f0001';
const ROSTER = '00000000-0000-4000-8000-0000000d0001';
const ALERT = '00000000-0000-4000-8000-0000000e0001';
const TX = { scoped: true };
const STORE = { fake: 'store' };

const state = vi.hoisted((): { session: AppSession | null; role: string | null } => ({
  session: null,
  role: 'owner',
}));

const runtime = vi.hoisted(() => ({
  memberRoleFor: vi.fn(() => Promise.resolve(state.role)),
  ownerGraceFor: vi.fn(() => Promise.resolve(null)),
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ scoped: true }),
  ),
  recordAccessDeniedFor: vi.fn(() => Promise.resolve()),
  previewRosterImportFor: vi.fn(),
  confirmRosterImportFor: vi.fn(),
}));
const court = vi.hoisted(() => ({ dismissAlert: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth.ts', () => ({
  getSession: () => Promise.resolve(state.session),
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../lib/storage.ts', () => ({ objectStore: () => STORE }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/court', () => court);
vi.mock('next/cache', () => ({ revalidatePath }));

const actions = await import('../app/(app)/w/[slug]/courts/rosters/actions.ts');

/** A core `WorkspaceError` as the actions see it. */
function workspaceError(code: string, message = code): Error {
  return Object.assign(new Error(message), { name: 'WorkspaceError', code });
}

const preview = {
  forumCode: 'in.tn.madras-hc.principal.appellate',
  effectiveFrom: null,
  effectiveFromRequired: true,
  candidates: [],
};
const previewInput = { workspaceId: WS, blobId: BLOB, forumCode: preview.forumCode };
const confirmInput = {
  workspaceId: WS,
  forumId: FORUM,
  effectiveFrom: '2026-10-05',
  entries: [{ hallNo: '1', judges: ['Justice A (fictional)'] }],
};
const dismissInput = { workspaceId: WS, alertId: ALERT };

beforeEach(() => {
  state.session = {
    session: { id: 'session-1' },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
  state.role = 'owner';
  runtime.previewRosterImportFor.mockResolvedValue(preview);
  runtime.confirmRosterImportFor.mockResolvedValue({
    roster: {
      roster: { id: ROSTER, version: 2, effectiveFrom: '2026-10-05' },
      entries: [],
    },
    alerts: [{ id: 'alert-1' }, { id: 'alert-2' }],
    detection: 'ok',
  });
  court.dismissAlert.mockResolvedValue({ id: ALERT, status: 'dismissed' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe.each(['owner', 'advocate'])('a %s', (role) => {
  beforeEach(() => {
    state.role = role;
  });

  it('previews an upload with the app object store', async () => {
    expect(await actions.previewRosterImportAction(previewInput)).toEqual({
      ok: true,
      data: preview,
    });
    expect(runtime.previewRosterImportFor).toHaveBeenCalledWith(
      { workspaceId: WS, userId: USER, store: STORE },
      { blobId: BLOB, forumCode: preview.forumCode },
    );
  });

  it('confirms a roster with detection and refreshes the rosters page', async () => {
    const result = await actions.confirmRosterImportAction({
      ...confirmInput,
      supersedeCurrent: true,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        rosterId: ROSTER,
        version: 2,
        effectiveFrom: '2026-10-05',
        alertsCreated: 2,
        detection: 'ok',
      },
    });
    expect(runtime.confirmRosterImportFor).toHaveBeenCalledWith(
      { workspaceId: WS, userId: USER },
      {
        forumId: FORUM,
        effectiveFrom: '2026-10-05',
        entries: [{ hallNo: '1', judges: ['Justice A (fictional)'], portfolioText: '' }],
        supersedeCurrent: true,
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/courts/rosters', 'page');
  });

  it('dismisses an alert on the workspace transaction', async () => {
    expect(await actions.dismissBenchChangeAlertAction(dismissInput)).toEqual({
      ok: true,
      data: { alertId: ALERT, status: 'dismissed' },
    });
    expect(court.dismissAlert).toHaveBeenCalledWith(
      TX,
      { userId: USER, workspaceId: WS },
      { alertId: ALERT },
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/courts/rosters', 'page');
  });
});

describe('workspace.manage on preview and confirm', () => {
  it.each(['junior', 'clerk', 'viewer'])(
    'a %s is FORBIDDEN before any runtime call',
    async (role) => {
      state.role = role;
      expect(await actions.previewRosterImportAction(previewInput)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(await actions.confirmRosterImportAction(confirmInput)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(runtime.previewRosterImportFor).not.toHaveBeenCalled();
      expect(runtime.confirmRosterImportFor).not.toHaveBeenCalled();
      expect(runtime.recordAccessDeniedFor).toHaveBeenCalled();
    },
  );

  it('a junior may dismiss; a clerk or viewer is FORBIDDEN', async () => {
    state.role = 'junior';
    expect(await actions.dismissBenchChangeAlertAction(dismissInput)).toMatchObject({ ok: true });
    for (const role of ['clerk', 'viewer']) {
      state.role = role;
      expect(await actions.dismissBenchChangeAlertAction(dismissInput)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    }
    expect(court.dismissAlert).toHaveBeenCalledTimes(1);
  });

  it('a non-member is FORBIDDEN on every action', async () => {
    state.role = null;
    for (const [call, input] of [
      [actions.previewRosterImportAction, previewInput],
      [actions.confirmRosterImportAction, confirmInput],
      [actions.dismissBenchChangeAlertAction, dismissInput],
    ] as const) {
      expect(await call(input)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(runtime.previewRosterImportFor).not.toHaveBeenCalled();
    expect(runtime.confirmRosterImportFor).not.toHaveBeenCalled();
    expect(court.dismissAlert).not.toHaveBeenCalled();
  });
});

describe('errors', () => {
  it("another workspace's blob, forum or alert is NOT_FOUND", async () => {
    runtime.previewRosterImportFor.mockRejectedValue(
      workspaceError('NOT_FOUND', 'Upload not found'),
    );
    runtime.confirmRosterImportFor.mockRejectedValue(
      workspaceError('NOT_FOUND', 'Forum not found'),
    );
    court.dismissAlert.mockRejectedValue(
      workspaceError('NOT_FOUND', 'Bench-change alert not found'),
    );
    expect(await actions.previewRosterImportAction(previewInput)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await actions.confirmRosterImportAction(confirmInput)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await actions.dismissBenchChangeAlertAction(dismissInput)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('confirming over an active roster without supersedeCurrent is CONFLICT', async () => {
    runtime.confirmRosterImportFor.mockRejectedValue(
      workspaceError('CONFLICT', 'This forum has an active roster: confirm superseding it'),
    );
    expect(await actions.confirmRosterImportAction(confirmInput)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
  });

  it('reports a detection that did not finish after the roster was confirmed', async () => {
    runtime.confirmRosterImportFor.mockResolvedValue({
      roster: { roster: { id: ROSTER, version: 1, effectiveFrom: '2026-10-05' }, entries: [] },
      alerts: [],
      detection: 'failed',
    });
    expect(await actions.confirmRosterImportAction(confirmInput)).toMatchObject({
      ok: true,
      data: { alertsCreated: 0, detection: 'failed' },
    });
  });

  it.each([
    [
      'a malformed blob id',
      () => actions.previewRosterImportAction({ ...previewInput, blobId: 'x' }),
    ],
    ['no entries', () => actions.confirmRosterImportAction({ ...confirmInput, entries: [] })],
    [
      'a malformed day',
      () => actions.confirmRosterImportAction({ ...confirmInput, effectiveFrom: '5 Oct' }),
    ],
    [
      'a malformed alert id',
      () => actions.dismissBenchChangeAlertAction({ ...dismissInput, alertId: 1 }),
    ],
  ])('%s is VALIDATION', async (_label, call) => {
    expect(await call()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(runtime.previewRosterImportFor).not.toHaveBeenCalled();
    expect(runtime.confirmRosterImportFor).not.toHaveBeenCalled();
    expect(court.dismissAlert).not.toHaveBeenCalled();
  });
});
