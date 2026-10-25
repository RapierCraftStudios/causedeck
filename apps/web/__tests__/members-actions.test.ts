// Members page server actions (#181): each runs through `workspaceAction` (zod, `requireSession`,
// membership) and calls the domain service on the workspace-scoped transaction. Invitations go
// through the auth mailer (console in dev/CI); the plaintext link reaches the client only outside
// production and never with the SES transport.
import type { AppSession } from '../lib/auth.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const MEMBER = '00000000-0000-4000-8000-0000000c0102';
const OTHER_MEMBER = '00000000-0000-4000-8000-0000000c0103';
const INVITATION = '00000000-0000-4000-8000-0000000d0101';
const NEW_OWNER = '00000000-0000-4000-8000-0000000b0102';
const TX = { scoped: true };

interface State {
  session: AppSession | null;
  role: string | null;
  prod: boolean;
  provider: string;
}

const state = vi.hoisted((): State => ({
  session: null,
  role: 'owner',
  prod: false,
  provider: 'console',
}));

const mailer = vi.hoisted(() => ({ send: vi.fn() }));
const createMailer = vi.hoisted(() => vi.fn(() => mailer));

const core = vi.hoisted(() => ({
  memberRole: vi.fn(() => Promise.resolve(state.role)),
  inviteMember: vi.fn(),
  changeRole: vi.fn(() => Promise.resolve()),
  removeMember: vi.fn(() => Promise.resolve()),
  listMembers: vi.fn(),
  countOpenWork: vi.fn(),
  reissueInvitation: vi.fn(),
  revokeInvitation: vi.fn(() => Promise.resolve()),
  prepareOwnershipTransfer: vi.fn(),
  transferOwnership: vi.fn(() => Promise.resolve()),
}));

const installBillingEntitlements = vi.hoisted(() => vi.fn());

const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
);
const revalidatePath = vi.hoisted(() => vi.fn());
const recordAccessDenied = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../lib/auth.ts', () => ({
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
}));
vi.mock('../lib/env.ts', () => ({
  isProd: () => state.prod,
  serverEnv: () => ({ APP_URL: 'http://localhost:3000', EMAIL_PROVIDER: state.provider }),
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/core/workspaces', () => core);
vi.mock('@causedeck/core/audit', () => ({ recordAccessDenied }));
vi.mock('@causedeck/core/billing', () => ({ installBillingEntitlements }));
vi.mock('@causedeck/auth/mailer', () => ({ createMailer }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next-intl/server', () => ({ getLocale: () => Promise.resolve('ta') }));

const actions = await import('../app/(app)/w/[slug]/settings/members/actions.ts');

class WorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

function issued(email: string, token: string) {
  return {
    invitation: { id: INVITATION, workspaceId: WS, email, role: 'junior', expiresAt: new Date() },
    token,
  };
}

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Asha', email: 'a@x.test' },
  } as AppSession;
  state.role = 'owner';
  state.prod = false;
  state.provider = 'console';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('membership guard', () => {
  it('rejects a non-member with FORBIDDEN before any domain call', async () => {
    state.role = null;
    const result = await actions.inviteMembersAction({
      workspaceId: WS,
      emails: ['n@x.test'],
      role: 'junior',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(core.inviteMember).not.toHaveBeenCalled();
    expect(withWorkspace).not.toHaveBeenCalled();
    expect(recordAccessDenied).toHaveBeenCalledWith(
      { fake: 'db' },
      expect.objectContaining({ workspaceId: WS, member: false }),
    );
  });

  it('rejects a signed-out caller as UNAUTHENTICATED', async () => {
    state.session = null;
    const result = await actions.removeMemberAction({ workspaceId: WS, memberId: MEMBER });
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('validates input with zod: owner is never an invite role', async () => {
    const result = await actions.inviteMembersAction({
      workspaceId: WS,
      emails: ['n@x.test'],
      role: 'owner',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(core.inviteMember).not.toHaveBeenCalled();
  });
});

describe('inviteMembersAction', () => {
  it('invites each address once on the workspace transaction with the console mailer', async () => {
    core.inviteMember.mockImplementation((_tx, request: { input: { email: string } }) =>
      Promise.resolve(issued(request.input.email, `tok-${request.input.email}`)),
    );
    const result = await actions.inviteMembersAction({
      workspaceId: WS,
      emails: ['One@X.test', 'one@x.test', 'two@x.test'],
      role: 'clerk',
      note: 'Welcome',
    });

    expect(withWorkspace).toHaveBeenCalledWith(
      { fake: 'db' },
      { workspaceId: WS, userId: USER },
      expect.any(Function),
    );
    expect(createMailer).toHaveBeenCalledWith(
      expect.objectContaining({ EMAIL_PROVIDER: 'console' }),
      expect.anything(),
    );
    expect(core.inviteMember).toHaveBeenCalledTimes(2);
    expect(core.inviteMember).toHaveBeenCalledWith(TX, {
      workspaceId: WS,
      actorUserId: USER,
      input: { email: 'one@x.test', role: 'clerk' },
      mailer,
      appUrl: 'http://localhost:3000',
      locale: 'ta',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        results: [
          {
            email: 'one@x.test',
            status: 'sent',
            link: 'http://localhost:3000/invite/tok-one@x.test',
          },
          {
            email: 'two@x.test',
            status: 'sent',
            link: 'http://localhost:3000/invite/tok-two@x.test',
          },
        ],
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/settings/members', 'page');
  });

  it('reports a failure per address and keeps inviting the rest', async () => {
    core.inviteMember
      .mockRejectedValueOnce(new WorkspaceError('RATE_LIMITED', 'Too many'))
      .mockRejectedValueOnce(new WorkspaceError('FORBIDDEN', 'No'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(issued('d@x.test', 'tok'));
    const result = await actions.inviteMembersAction({
      workspaceId: WS,
      emails: ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test'],
      role: 'junior',
    });
    expect(result.ok && result.data.results.map((r) => r.status)).toEqual([
      'rateLimited',
      'forbidden',
      'failed',
      'sent',
    ]);
  });

  it('installs the billing seat gate and reports a seat limit with the plan seats (#203)', async () => {
    const exceeded = Object.assign(new Error('Entitlement seats exceeded'), {
      name: 'EntitlementError',
      code: 'ENTITLEMENT_EXCEEDED',
      key: 'seats',
      limit: 3,
      requested: 4,
    });
    core.inviteMember
      .mockResolvedValueOnce(issued('a@x.test', 'tok'))
      .mockRejectedValueOnce(exceeded);
    const result = await actions.inviteMembersAction({
      workspaceId: WS,
      emails: ['a@x.test', 'b@x.test'],
      role: 'advocate',
    });
    expect(installBillingEntitlements).toHaveBeenCalled();
    expect(result.ok && result.data.results[1]).toEqual({
      email: 'b@x.test',
      status: 'seatLimit',
      seats: 3,
    });
  });

  it.each([
    ['in production', { prod: true, provider: 'console' }],
    ['with the SES transport', { prod: false, provider: 'ses' }],
  ])('never returns the invite link %s', async (_label, env) => {
    state.prod = env.prod;
    state.provider = env.provider;
    core.inviteMember.mockResolvedValue(issued('a@x.test', 'secret-token'));
    const result = await actions.inviteMembersAction({
      workspaceId: WS,
      emails: ['a@x.test'],
      role: 'junior',
    });
    expect(result).toEqual({
      ok: true,
      data: { results: [{ email: 'a@x.test', status: 'sent' }] },
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
});

describe('member actions', () => {
  it('changes a role and maps the last-owner guard to CONFLICT', async () => {
    const ok = await actions.changeRoleAction({ workspaceId: WS, memberId: MEMBER, role: 'clerk' });
    expect(ok).toEqual({ ok: true, data: { memberId: MEMBER, role: 'clerk' } });
    expect(core.changeRole).toHaveBeenCalledWith(TX, {
      workspaceId: WS,
      actorUserId: USER,
      memberId: MEMBER,
      role: 'clerk',
    });

    core.changeRole.mockRejectedValueOnce(new WorkspaceError('CONFLICT', 'last owner'));
    const conflict = await actions.changeRoleAction({
      workspaceId: WS,
      memberId: MEMBER,
      role: 'viewer',
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('removes a member with the chosen reassignment', async () => {
    const result = await actions.removeMemberAction({
      workspaceId: WS,
      memberId: MEMBER,
      reassignTo: OTHER_MEMBER,
    });
    expect(result).toEqual({ ok: true, data: { memberId: MEMBER } });
    expect(core.removeMember).toHaveBeenCalledWith(TX, {
      workspaceId: WS,
      actorUserId: USER,
      memberId: MEMBER,
      reassignTo: OTHER_MEMBER,
    });
  });

  it('counts the open work of the member being removed, 0 for an unknown member', async () => {
    core.listMembers.mockResolvedValue([{ memberId: MEMBER, userId: NEW_OWNER }]);
    core.countOpenWork.mockResolvedValue(3);
    expect(await actions.openWorkAction({ workspaceId: WS, memberId: MEMBER })).toEqual({
      ok: true,
      data: { count: 3 },
    });
    expect(core.countOpenWork).toHaveBeenCalledWith(TX, WS, NEW_OWNER);
    expect(await actions.openWorkAction({ workspaceId: WS, memberId: OTHER_MEMBER })).toEqual({
      ok: true,
      data: { count: 0 },
    });
  });

  it('runs the two-step ownership transfer', async () => {
    core.prepareOwnershipTransfer.mockResolvedValue({
      confirmation: 'chennai-solo',
      newOwner: { userId: NEW_OWNER, name: 'Kavya', email: 'k@x.test', role: 'advocate' },
    });
    const plan = await actions.prepareTransferAction({
      workspaceId: WS,
      newOwnerUserId: NEW_OWNER,
    });
    expect(plan).toEqual({
      ok: true,
      data: {
        confirmation: 'chennai-solo',
        newOwner: { userId: NEW_OWNER, name: 'Kavya', email: 'k@x.test' },
      },
    });
    await actions.confirmTransferAction({
      workspaceId: WS,
      newOwnerUserId: NEW_OWNER,
      confirmation: ' chennai-solo ',
    });
    expect(core.transferOwnership).toHaveBeenCalledWith(TX, {
      workspaceId: WS,
      actorUserId: USER,
      newOwnerUserId: NEW_OWNER,
      confirmation: 'chennai-solo',
    });
  });
});

describe('invitation actions', () => {
  it('resends with a fresh link in dev and revokes', async () => {
    core.reissueInvitation.mockResolvedValue(issued('a@x.test', 'fresh'));
    expect(
      await actions.resendInvitationAction({ workspaceId: WS, invitationId: INVITATION }),
    ).toEqual({
      ok: true,
      data: { email: 'a@x.test', link: 'http://localhost:3000/invite/fresh' },
    });
    expect(core.reissueInvitation).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ workspaceId: WS, actorUserId: USER, invitationId: INVITATION }),
    );

    expect(
      await actions.revokeInvitationAction({ workspaceId: WS, invitationId: INVITATION }),
    ).toEqual({ ok: true, data: { invitationId: INVITATION } });
    expect(core.revokeInvitation).toHaveBeenCalledWith(TX, {
      workspaceId: WS,
      actorUserId: USER,
      invitationId: INVITATION,
    });
  });
});
