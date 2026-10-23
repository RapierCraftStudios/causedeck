// Lifecycle server actions (#305): export, workspace deletion and account deletion. The workspace
// ones go through `workspaceAction` with the owner-only policy actions (`export.run`,
// `workspace.delete`), so other roles are FORBIDDEN and recorded before any service runs. They pass
// the caller's Better Auth session id to `@causedeck/core/runtime` (the step-up check, #304) and turn
// the core step-up refusal into FORBIDDEN with `fieldErrors.stepUp`, which the UI answers with
// `Confirm it is you`. A wrong workspace name is VALIDATION on `confirmName`. The export is dark
// (NOT_FOUND) while `workspace.export` is off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const SESSION_ID = 'session-1';
const JOB = '00000000-0000-4000-8000-0000000e0001';

const state = vi.hoisted(() => ({
  session: null as AppSession | null,
  role: 'owner',
  exportFlag: true,
}));

/** The core refusal for a missing or stale step-up (`StepUpForbiddenError`). */
function stepUpRefusal(): Error {
  return Object.assign(new Error('Confirm it is you with your passkey or authenticator code'), {
    name: 'WorkspaceError',
    code: 'FORBIDDEN',
    reason: 'step_up_required',
  });
}

const runtime = vi.hoisted(() => ({
  memberRoleFor: vi.fn(() => Promise.resolve(state.role)),
  ownerGraceFor: vi.fn(() => Promise.resolve(null)),
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ scoped: true }),
  ),
  recordAccessDeniedFor: vi.fn(() => Promise.resolve()),
  requestExportFor: vi.fn(),
  listExportJobsFor: vi.fn(),
  requestWorkspaceDeletionFor: vi.fn(),
  cancelWorkspaceDeletionFor: vi.fn(),
  requestAccountDeletionFor: vi.fn(),
}));
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
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/flags/server', () => ({
  isEnabled: () => Promise.resolve(state.exportFlag),
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'user-agent': 'vitest' })),
  cookies: () => Promise.resolve({ set: vi.fn() }),
}));

const { requestExportAction, listExportsAction } =
  await import('../app/(app)/w/[slug]/settings/export/actions.ts');
const { requestWorkspaceDeletionAction, cancelWorkspaceDeletionAction } =
  await import('../app/(app)/w/[slug]/settings/danger/actions.ts');
const { requestAccountDeletionAction } = await import('../app/(app)/account/actions.ts');

const exportJob = {
  id: JOB,
  workspaceId: WS,
  requestedBy: USER,
  scope: 'workspace',
  status: 'queued',
  progress: 0,
  phase: null,
  sizeBytes: null,
  sha256: null,
  errorCode: null,
  createdAt: new Date('2026-10-20T10:00:00Z'),
  completedAt: null,
  expiresAt: null,
};
const deletionJob = {
  id: JOB,
  workspaceId: WS,
  requestedBy: USER,
  status: 'pending_cooloff',
  cooloffUntil: new Date('2026-11-03T10:00:00Z'),
  eraseAfter: new Date('2026-11-03T10:00:00Z'),
  createdAt: new Date('2026-10-20T10:00:00Z'),
  completedAt: null,
};

beforeEach(() => {
  state.session = {
    session: { id: SESSION_ID },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
  state.role = 'owner';
  state.exportFlag = true;
  runtime.requestExportFor.mockResolvedValue(exportJob);
  runtime.listExportJobsFor.mockResolvedValue([exportJob]);
  runtime.requestWorkspaceDeletionFor.mockResolvedValue(deletionJob);
  runtime.cancelWorkspaceDeletionFor.mockResolvedValue({ ...deletionJob, status: 'cancelled' });
  runtime.requestAccountDeletionFor.mockResolvedValue({
    id: JOB,
    status: 'scheduled',
    createdAt: new Date(),
    completedAt: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const forbiddenRoles = ['advocate', 'junior', 'clerk', 'viewer'] as const;

describe('requestExportAction', () => {
  it('requests a workspace export with the caller’s session id and returns the job', async () => {
    expect(await requestExportAction({ workspaceId: WS })).toEqual({
      ok: true,
      data: {
        id: JOB,
        status: 'queued',
        progress: 0,
        phase: null,
        sizeBytes: null,
        sha256: null,
        createdAt: '2026-10-20T10:00:00.000Z',
        expiresAt: null,
      },
    });
    expect(runtime.requestExportFor).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        userId: USER,
        sessionId: SESSION_ID,
        userAgent: 'vitest',
      }),
      { scope: 'workspace' },
    );
  });

  it('turns a stale step-up into FORBIDDEN with fieldErrors.stepUp', async () => {
    runtime.requestExportFor.mockRejectedValue(stepUpRefusal());
    expect(await requestExportAction({ workspaceId: WS })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', fieldErrors: { stepUp: ['required'] } },
    });
  });

  it.each(forbiddenRoles)('refuses a %s with FORBIDDEN and records the denial', async (role) => {
    state.role = role;
    const result = await requestExportAction({ workspaceId: WS });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(result).not.toHaveProperty('error.fieldErrors');
    expect(runtime.requestExportFor).not.toHaveBeenCalled();
    expect(runtime.recordAccessDeniedFor).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, actorUserId: USER, action: 'export.run' }),
    );
  });

  it('is NOT_FOUND while workspace.export is off', async () => {
    state.exportFlag = false;
    expect(await requestExportAction({ workspaceId: WS })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(runtime.requestExportFor).not.toHaveBeenCalled();
  });
});

describe('listExportsAction', () => {
  it('lists the caller’s exports for the poll', async () => {
    const result = await listExportsAction({ workspaceId: WS });
    expect(result).toMatchObject({ ok: true, data: [{ id: JOB, status: 'queued' }] });
    expect(runtime.listExportJobsFor).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, userId: USER }),
    );
  });

  it('refuses a clerk', async () => {
    state.role = 'clerk';
    expect(await listExportsAction({ workspaceId: WS })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(runtime.listExportJobsFor).not.toHaveBeenCalled();
  });
});

describe('requestWorkspaceDeletionAction', () => {
  const input = { workspaceId: WS, confirmName: 'Demo Chambers' };

  it('requests deletion with the typed name and session id, then refreshes the shell', async () => {
    expect(await requestWorkspaceDeletionAction(input)).toEqual({
      ok: true,
      data: { jobId: JOB, status: 'pending_cooloff', cooloffUntil: '2026-11-03T10:00:00.000Z' },
    });
    expect(runtime.requestWorkspaceDeletionFor).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, userId: USER, sessionId: SESSION_ID }),
      { confirmName: 'Demo Chambers' },
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]', 'layout');
  });

  it('turns a stale step-up into FORBIDDEN with fieldErrors.stepUp', async () => {
    runtime.requestWorkspaceDeletionFor.mockRejectedValue(stepUpRefusal());
    expect(await requestWorkspaceDeletionAction(input)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', fieldErrors: { stepUp: ['required'] } },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('turns a wrong name into VALIDATION on confirmName', async () => {
    runtime.requestWorkspaceDeletionFor.mockRejectedValue(
      Object.assign(new Error('Type the workspace name exactly to confirm deletion'), {
        name: 'WorkspaceError',
        code: 'VALIDATION',
        reason: 'CONFIRM_NAME_MISMATCH',
      }),
    );
    expect(await requestWorkspaceDeletionAction(input)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', fieldErrors: { confirmName: ['mismatch'] } },
    });
  });

  it.each(forbiddenRoles)('refuses a %s with FORBIDDEN and records the denial', async (role) => {
    state.role = role;
    expect(await requestWorkspaceDeletionAction(input)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(runtime.requestWorkspaceDeletionFor).not.toHaveBeenCalled();
    expect(runtime.recordAccessDeniedFor).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, action: 'workspace.delete' }),
    );
  });
});

describe('cancelWorkspaceDeletionAction', () => {
  it('cancels for an owner and refreshes the shell', async () => {
    expect(await cancelWorkspaceDeletionAction({ workspaceId: WS, jobId: JOB })).toMatchObject({
      ok: true,
      data: { jobId: JOB, status: 'cancelled' },
    });
    expect(runtime.cancelWorkspaceDeletionFor).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, sessionId: SESSION_ID }),
      JOB,
    );
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]', 'layout');
  });

  it('asks for step-up when it is stale', async () => {
    runtime.cancelWorkspaceDeletionFor.mockRejectedValue(stepUpRefusal());
    expect(await cancelWorkspaceDeletionAction({ workspaceId: WS, jobId: JOB })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', fieldErrors: { stepUp: ['required'] } },
    });
  });

  it('refuses a non-owner', async () => {
    state.role = 'advocate';
    expect(await cancelWorkspaceDeletionAction({ workspaceId: WS, jobId: JOB })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(runtime.cancelWorkspaceDeletionFor).not.toHaveBeenCalled();
  });
});

describe('requestAccountDeletionAction', () => {
  it('requests deletion of the caller’s own account with the session id', async () => {
    expect(await requestAccountDeletionAction({})).toEqual({
      ok: true,
      data: { jobId: JOB, status: 'scheduled' },
    });
    expect(runtime.requestAccountDeletionFor).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, sessionId: SESSION_ID }),
    );
  });

  it('asks for step-up when it is stale', async () => {
    runtime.requestAccountDeletionFor.mockRejectedValue(stepUpRefusal());
    expect(await requestAccountDeletionAction({})).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', fieldErrors: { stepUp: ['required'] } },
    });
  });

  it('passes the sole-owner CONFLICT message through', async () => {
    runtime.requestAccountDeletionFor.mockRejectedValue(
      Object.assign(new Error('You are the only owner of a workspace: Demo Chambers'), {
        name: 'WorkspaceError',
        code: 'CONFLICT',
      }),
    );
    expect(await requestAccountDeletionAction({})).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: 'You are the only owner of a workspace: Demo Chambers' },
    });
  });

  it('is UNAUTHENTICATED when signed out', async () => {
    state.session = null;
    expect(await requestAccountDeletionAction({})).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(runtime.requestAccountDeletionFor).not.toHaveBeenCalled();
  });
});
