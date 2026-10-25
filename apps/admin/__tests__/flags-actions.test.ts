// The flags page's server side (#311): every action needs the `flags` capability, a legal-gated
// enable only ever becomes a request (note + acknowledgement + fresh TOTP), only an admin approves
// (fresh TOTP again), flag errors become plain messages, and lib/flags.ts installs the real audit
// writer and marks kill-switched flags. `@causedeck/flags` is mocked; its DB behaviour is covered
// in packages/flags/src/__tests__/approvals.test.ts.
import type * as FlagsModule from '@causedeck/flags';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FlagsLib from '../lib/flags.ts';

const SINK = { write: vi.fn() };
const requireStaff = vi.fn();
const reverifyTotp = vi.fn();

vi.mock('../lib/staff.ts', () => ({ requireStaff }));
vi.mock('@causedeck/core/runtime', () => ({ db: { tag: 'db' } }));
vi.mock('@causedeck/core/audit', () => ({ flagChangeAuditSink: SINK, record: vi.fn() }));
vi.mock('@causedeck/auth/rate-limit', () => ({ consumeRateLimit: vi.fn() }));
vi.mock('../lib/auth.ts', () => ({ getAuth: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('../lib/env.ts', () => ({
  serverEnv: () => ({ NODE_ENV: 'test', killSwitches: { KILL_INVOICES_ENABLED: true } }),
  adminEnv: () => ({ NODE_ENV: 'production' }),
}));
vi.mock('@causedeck/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof FlagsModule>();
  return {
    ...actual,
    setFlagAuditSink: vi.fn(),
    setFlag: vi.fn(),
    setWorkspaceFlag: vi.fn(),
    requestLegalEnable: vi.fn(),
    approveLegalEnable: vi.fn(),
    rejectLegalEnable: vi.fn(),
    listGlobalFlagRows: vi.fn(),
    listFlagChangeRequests: vi.fn(),
    loadFlagRows: vi.fn(),
  };
});
vi.mock('../lib/flags.ts', () => ({ reverifyTotp }));

const flags = await import('@causedeck/flags');
const actions = await import('../app/(console)/flags/actions.ts');

const OPS = { userId: '0b6c1a52-8a3e-4d7f-9c1e-5f2a7b3c4d5e', email: 'ops@x.test', role: 'ops' };
const ADMIN = { ...OPS, userId: '1c7d2b63-9b4f-4e8a-8d2f-6a3b8c4d5e6f', role: 'admin' };
const WS = '2d8e3c74-0c5a-4f9b-9e3a-7b4c9d5e6f70';
const REQ = '3e9f4d85-1d6b-4a0c-8f4b-8c5d0e6f7081';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(OPS);
  reverifyTotp.mockResolvedValue({ ok: true });
});

describe('access', () => {
  it('every action asks requireStaff for the flags capability', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    const calls = [
      actions.setFlagAction({}, form({ key: 'pwa.offline', enabled: 'true' })),
      actions.requestLegalEnableAction({}, form({ key: 'invoices.enabled' })),
      actions.approveLegalEnableAction({}, form({ requestId: REQ })),
      actions.rejectLegalEnableAction({}, form({ requestId: REQ })),
    ];
    for (const call of calls) await expect(call).rejects.toThrow('NEXT_NOT_FOUND');
    expect(requireStaff.mock.calls).toEqual([['flags'], ['flags'], ['flags'], ['flags']]);
    expect(flags.setFlag).not.toHaveBeenCalled();
  });

  it('only an admin may approve', async () => {
    await expect(actions.approveLegalEnableAction({}, form({ requestId: REQ }))).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(flags.approveLegalEnable).not.toHaveBeenCalled();
  });
});

describe('setFlagAction', () => {
  it('sets a global flag and a workspace override', async () => {
    expect(await actions.setFlagAction({}, form({ key: 'pwa.offline', enabled: 'true' }))).toEqual({
      done: 'pwa.offline is now on.',
    });
    expect(flags.setFlag).toHaveBeenCalledWith(
      { tag: 'db' },
      expect.objectContaining({ userId: OPS.userId }),
      { key: 'pwa.offline', enabled: true },
    );
    await actions.setFlagAction(
      {},
      form({ key: 'invoices.enabled', enabled: 'false', workspaceId: WS }),
    );
    expect(flags.setWorkspaceFlag).toHaveBeenCalledWith(
      { tag: 'db' },
      expect.objectContaining({ userId: OPS.userId }),
      { workspaceId: WS, key: 'invoices.enabled', enabled: false },
    );
  });

  it('reports an unknown workspace id instead of failing', async () => {
    vi.mocked(flags.setWorkspaceFlag).mockRejectedValueOnce(
      Object.assign(new Error('query failed'), { cause: { code: '23503' } }),
    );
    expect(
      await actions.setFlagAction(
        {},
        form({ key: 'pwa.offline', enabled: 'true', workspaceId: WS }),
      ),
    ).toEqual({ error: 'No workspace has that id.' });
  });

  it('refuses a legal-gated enable and unknown keys', async () => {
    expect(
      await actions.setFlagAction({}, form({ key: 'invoices.enabled', enabled: 'true' })),
    ).toHaveProperty('error', expect.stringContaining('second admin') as unknown);
    expect(
      await actions.setFlagAction({}, form({ key: 'nope.flag', enabled: 'true' })),
    ).toHaveProperty('error');
    expect(flags.setFlag).not.toHaveBeenCalled();
  });
});

describe('requestLegalEnableAction', () => {
  it('needs the note, the acknowledgement and a fresh TOTP code', async () => {
    expect(
      await actions.requestLegalEnableAction({}, form({ key: 'invoices.enabled', note: 'x' })),
    ).toHaveProperty('error');
    expect(
      await actions.requestLegalEnableAction(
        {},
        form({ key: 'invoices.enabled', note: ' ', acknowledged: 'on' }),
      ),
    ).toHaveProperty('error');
    reverifyTotp.mockResolvedValueOnce({ ok: false, error: 'That code did not work. Try again.' });
    expect(
      await actions.requestLegalEnableAction(
        {},
        form({ key: 'invoices.enabled', note: 'Counsel #120', acknowledged: 'on', code: '1' }),
      ),
    ).toEqual({ error: 'That code did not work. Try again.' });
    expect(flags.requestLegalEnable).not.toHaveBeenCalled();

    const result = await actions.requestLegalEnableAction(
      {},
      form({
        key: 'invoices.enabled',
        note: ' Counsel #120 ',
        acknowledged: 'on',
        code: '123456',
        workspaceId: WS,
      }),
    );
    expect(result.done).toContain('second admin');
    expect(reverifyTotp).toHaveBeenLastCalledWith(OPS, '123456');
    expect(flags.requestLegalEnable).toHaveBeenCalledWith(
      { tag: 'db' },
      expect.objectContaining({ userId: OPS.userId }),
      { key: 'invoices.enabled', workspaceId: WS, legalAckNote: 'Counsel #120' },
    );
  });

  it('maps flag errors to messages', async () => {
    vi.mocked(flags.requestLegalEnable).mockRejectedValueOnce(
      new flags.FlagAdminError('REQUEST_PENDING', 'pending'),
    );
    expect(
      await actions.requestLegalEnableAction(
        {},
        form({ key: 'invoices.enabled', note: 'n', acknowledged: 'on', code: '123456' }),
      ),
    ).toEqual({ error: 'This flag already has a request waiting for approval.' });
  });
});

describe('approve and reject', () => {
  it('an admin approves with a fresh TOTP code', async () => {
    requireStaff.mockResolvedValue(ADMIN);
    reverifyTotp.mockResolvedValueOnce({ ok: false, error: 'bad code' });
    expect(await actions.approveLegalEnableAction({}, form({ requestId: REQ, code: '1' }))).toEqual(
      { error: 'bad code' },
    );
    expect(flags.approveLegalEnable).not.toHaveBeenCalled();

    expect(
      await actions.approveLegalEnableAction({}, form({ requestId: REQ, code: '123456' })),
    ).toEqual({ done: 'Approved: the flag is on.' });
    expect(flags.approveLegalEnable).toHaveBeenCalledWith(
      { tag: 'db' },
      expect.objectContaining({ userId: ADMIN.userId }),
      { requestId: REQ },
    );

    vi.mocked(flags.approveLegalEnable).mockRejectedValueOnce(
      new flags.FlagAdminError('SELF_APPROVAL', 'self'),
    );
    expect(
      await actions.approveLegalEnableAction({}, form({ requestId: REQ, code: '123456' })),
    ).toEqual({ error: 'A second admin must approve your own request.' });
  });

  it('reject passes the request through', async () => {
    expect(await actions.rejectLegalEnableAction({}, form({ requestId: REQ }))).toEqual({
      done: 'Request closed.',
    });
    expect(flags.rejectLegalEnable).toHaveBeenCalledWith(
      { tag: 'db' },
      expect.objectContaining({ userId: OPS.userId }),
      { requestId: REQ },
    );
    expect(await actions.rejectLegalEnableAction({}, form({ requestId: 'x' }))).toHaveProperty(
      'error',
    );
  });
});

describe('lib/flags.ts', () => {
  it('installs flagChangeAuditSink and marks kill-switched flags forced off', async () => {
    const lib = await vi.importActual<typeof FlagsLib>('../lib/flags.ts');
    expect(flags.setFlagAuditSink).toHaveBeenCalledWith(SINK);

    vi.mocked(flags.listGlobalFlagRows).mockResolvedValue([
      {
        key: 'invoices.enabled',
        enabled: true,
        legalAckBy: OPS.userId,
        updatedBy: ADMIN.userId,
        updatedAt: new Date(),
      },
      {
        key: 'pwa.offline',
        enabled: true,
        legalAckBy: null,
        updatedBy: ADMIN.userId,
        updatedAt: new Date(),
      },
    ]);
    const rows = await lib.flagRowsView(OPS as never);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey['invoices.enabled']).toMatchObject({
      killed: true,
      killSwitchEnv: 'KILL_INVOICES_ENABLED',
      global: true,
      effective: false,
      legalGated: true,
    });
    expect(byKey['pwa.offline']).toMatchObject({ killed: false, global: true, effective: true });
    expect(byKey['ai.sarvam']).toMatchObject({ global: null, effective: false });
    expect(JSON.stringify(rows)).not.toContain(OPS.userId);
  });
});
