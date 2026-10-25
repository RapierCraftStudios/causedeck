// The shared workspace server-action guard (#179) and the create-workspace action: zod first, then
// `requireSession`, then membership, with non-members rejected as FORBIDDEN before any handler
// work, and domain `WorkspaceError`s surfaced as their action codes.
import type { WorkspaceRole } from '@causedeck/core/workspaces';
import type { Transaction } from '@causedeck/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AppSession } from '../lib/auth.ts';
import {
  toActionError,
  workspaceAction,
  WorkspaceScoped,
  type WorkspaceActionOptions,
} from '../lib/workspace-action.ts';

const auth = vi.hoisted(() => ({ session: null as AppSession | null }));
const core = vi.hoisted(() => ({ createWorkspace: vi.fn() }));

vi.mock('../lib/auth.ts', () => ({
  requireSession: () => {
    if (!auth.session) {
      return Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' }));
    }
    return Promise.resolve(auth.session);
  },
}));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' } }));
vi.mock('@causedeck/core/workspaces', () => ({ createWorkspace: core.createWorkspace }));

const WS = '00000000-0000-4000-8000-00000000a001';
const OTHER_WS = '00000000-0000-4000-8000-00000000a002';
const USER = '00000000-0000-4000-8000-0000000b0101';

const session = { session: {}, user: { id: USER, name: 'M', email: 'm@x.test' } } as AppSession;

class WorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

const Rename = WorkspaceScoped.extend({ name: z.string().min(1) });

function setup(roles: Record<string, WorkspaceRole | null> = { [WS]: 'owner' }) {
  const handler = vi.fn((input: z.infer<typeof Rename>, ctx: { role: string; tx: unknown }) =>
    Promise.resolve({ renamed: input.name, role: ctx.role, tx: ctx.tx }),
  );
  const memberRole = vi.fn((_userId: string, workspaceId: string) =>
    Promise.resolve(roles[workspaceId] ?? null),
  );
  const runInWorkspace = vi.fn(
    (_scope: { workspaceId: string; userId: string }, fn: (tx: Transaction) => Promise<unknown>) =>
      fn({ scoped: true } as unknown as Transaction),
  );
  const requireSession = vi.fn(() =>
    auth.session
      ? Promise.resolve(auth.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
  );
  const action = workspaceAction(Rename, handler, {
    requireSession,
    memberRole,
    runInWorkspace: runInWorkspace as NonNullable<WorkspaceActionOptions['runInWorkspace']>,
  });
  return { action, handler, memberRole, runInWorkspace, requireSession };
}

afterEach(() => {
  auth.session = null;
  vi.clearAllMocks();
});

describe('workspaceAction guard', () => {
  it('validates with zod first: VALIDATION with field errors, no session or DB touched', async () => {
    auth.session = session;
    const { action, handler, memberRole, requireSession } = setup();
    const result = await action({ workspaceId: 'not-a-uuid', name: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION');
    expect(Object.keys(result.error.fieldErrors ?? {}).sort()).toEqual(['name', 'workspaceId']);
    expect(requireSession).not.toHaveBeenCalled();
    expect(memberRole).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('authenticates via requireSession: UNAUTHENTICATED when signed out', async () => {
    const { action, handler, memberRole } = setup();
    const result = await action({ workspaceId: WS, name: 'x' });
    expect(!result.ok && result.error.code).toBe('UNAUTHENTICATED');
    expect(memberRole).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a non-member (or removed member, or soft-deleted workspace) with FORBIDDEN', async () => {
    auth.session = session;
    const { action, handler, memberRole, runInWorkspace } = setup({ [WS]: 'owner' });
    const result = await action({ workspaceId: OTHER_WS, name: 'x' });
    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'You do not have access to this.' },
    });
    expect(memberRole).toHaveBeenCalledWith(USER, OTHER_WS);
    expect(runInWorkspace).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs a member through withWorkspace with their role and the scoped transaction', async () => {
    auth.session = session;
    const { action, runInWorkspace } = setup({ [WS]: 'clerk' });
    const result = await action({ workspaceId: WS, name: 'New name' });
    expect(result).toEqual({
      ok: true,
      data: { renamed: 'New name', role: 'clerk', tx: { scoped: true } },
    });
    expect(runInWorkspace).toHaveBeenCalledWith(
      { workspaceId: WS, userId: USER },
      expect.any(Function),
    );
  });

  it('maps a WorkspaceError from the handler to its action code and message', async () => {
    auth.session = session;
    const { action, handler } = setup();
    handler.mockRejectedValueOnce(new WorkspaceError('CONFLICT', 'The last owner cannot leave'));
    expect(await action({ workspaceId: WS, name: 'x' })).toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'The last owner cannot leave' },
    });
  });

  it('hides unknown errors as INTERNAL', async () => {
    auth.session = session;
    const { action, handler } = setup();
    handler.mockRejectedValueOnce(new Error('connection reset: password=hunter2'));
    const result = await action({ workspaceId: WS, name: 'x' });
    expect(!result.ok && result.error).toEqual({
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again.',
    });
  });

  it('toActionError leaves non-workspace errors alone', () => {
    const plain = new Error('x');
    expect(toActionError(plain)).toBe(plain);
    expect(toActionError(new WorkspaceError('NOPE', 'x'))).toBeInstanceOf(WorkspaceError);
  });
});

const { createWorkspaceAction } = await import('../app/(app)/onboarding/actions.ts');

describe('createWorkspaceAction', () => {
  it('creates the workspace for the signed-in user and returns its slug', async () => {
    auth.session = session;
    core.createWorkspace.mockResolvedValueOnce({ id: WS, slug: 'hebbal-chambers' });
    const result = await createWorkspaceAction({ name: '  Hebbal Chambers ', kind: 'chamber' });
    expect(result).toEqual({ ok: true, data: { slug: 'hebbal-chambers' } });
    expect(core.createWorkspace).toHaveBeenCalledWith(
      { fake: 'db' },
      { userId: USER, input: { name: 'Hebbal Chambers', kind: 'chamber' } },
    );
  });

  it('rejects invalid input with VALIDATION before reading the session', async () => {
    const result = await createWorkspaceAction({ name: '', kind: 'firm' });
    expect(!result.ok && result.error.code).toBe('VALIDATION');
    expect(!result.ok && Object.keys(result.error.fieldErrors ?? {}).sort()).toEqual([
      'kind',
      'name',
    ]);
    expect(core.createWorkspace).not.toHaveBeenCalled();
  });

  it('is UNAUTHENTICATED when signed out', async () => {
    const result = await createWorkspaceAction({ name: 'Solo', kind: 'solo' });
    expect(!result.ok && result.error.code).toBe('UNAUTHENTICATED');
    expect(core.createWorkspace).not.toHaveBeenCalled();
  });

  it('surfaces the service VALIDATION (e.g. a name with no usable slug)', async () => {
    auth.session = session;
    core.createWorkspace.mockRejectedValueOnce(new WorkspaceError('VALIDATION', 'Bad name'));
    const result = await createWorkspaceAction({ name: '!!!', kind: 'solo' });
    expect(!result.ok && result.error).toEqual({ code: 'VALIDATION', message: 'Bad name' });
  });
});
