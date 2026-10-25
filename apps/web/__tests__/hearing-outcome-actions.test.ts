// Hearing outcome server actions (#62). `workspaceAction` needs `matter.write`, so a viewer or a
// clerk is FORBIDDEN before core runs; the acting user is the session's; a domain refusal keeps its
// code; the input is the validators' schema (an unresolved next date is VALIDATION, nothing runs).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const HEARING = '00000000-0000-4000-8000-0000000d0001';

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
}));
const hearings = vi.hoisted(() => ({ confirmOutcome: vi.fn(), recordManualOutcome: vi.fn() }));
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
vi.mock('@causedeck/core/hearings', () => hearings);
vi.mock('next/cache', () => ({ revalidatePath }));

const actions = await import('../app/(app)/w/[slug]/hearings/[hearingId]/outcome/actions.ts');

const input = {
  workspaceId: WS,
  hearingId: HEARING,
  outcome: 'Adjourned for arguments',
  nextDate: { kind: 'to_be_notified' },
};
const done = { hearingId: HEARING, nextDate: null, obligationIds: [], taskIds: [] };

beforeEach(() => {
  state.session = {
    session: { id: 'session-1' },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
  state.role = 'owner';
  hearings.confirmOutcome.mockResolvedValue(done);
  hearings.recordManualOutcome.mockResolvedValue(done);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('confirmOutcomeAction (#62)', () => {
  it('confirms for the session user on the workspace transaction and revalidates', async () => {
    const result = await actions.confirmOutcomeAction(input);
    expect(result).toEqual({ ok: true, data: done });
    const [deps, actor, body] = hearings.confirmOutcome.mock.calls[0] ?? [];
    expect(deps.db).toEqual({ scoped: true });
    expect(actor).toEqual({ workspaceId: WS, userId: USER });
    expect(body).not.toHaveProperty('workspaceId');
    expect(revalidatePath).toHaveBeenCalled();
  });

  it.each(['viewer', 'clerk'])('denies a %s before core runs', async (role) => {
    state.role = role;
    const result = await actions.confirmOutcomeAction(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(hearings.confirmOutcome).not.toHaveBeenCalled();
  });

  it('rejects an input without a next date resolution', async () => {
    const { nextDate: _omit, ...rest } = input;
    const result = await actions.confirmOutcomeAction(rest);
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(hearings.confirmOutcome).not.toHaveBeenCalled();
  });

  it('keeps the code of a domain refusal', async () => {
    const error = Object.assign(new Error('This hearing outcome is already confirmed'), {
      name: 'WorkspaceError',
      code: 'CONFLICT',
    });
    hearings.confirmOutcome.mockRejectedValue(error);
    const result = await actions.confirmOutcomeAction(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
});

describe('recordManualOutcomeAction (#62)', () => {
  it('records the L0 outcome and passes no proposals through', async () => {
    expect(await actions.recordManualOutcomeAction(input)).toEqual({ ok: true, data: done });
    expect(hearings.recordManualOutcome).toHaveBeenCalledTimes(1);
    await actions.recordManualOutcomeAction({ ...input, obligations: [{ action: 'confirm' }] });
    expect(hearings.recordManualOutcome.mock.calls[1]?.[2]).not.toHaveProperty('obligations');
  });
});
