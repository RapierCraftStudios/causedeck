// Account security actions (#289): profile name, TOTP setup, passkey removal and session
// revocation. Each is a zod-validated `safeAction` that needs a session and touches only the
// caller's own user; anything else is FORBIDDEN. Better Auth is mocked at `getAuth().api`.
import { APIError } from 'better-auth/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../src/health.ts', () => ({ logger }));

const cookieSet = vi.hoisted(() => vi.fn());
const requestHeaders = vi.hoisted(() => new Headers({ 'user-agent': 'vitest' }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: cookieSet }),
  headers: () => Promise.resolve(requestHeaders),
}));

const runtime = vi.hoisted(() => ({
  recordAccountProfileUpdatedFor: vi.fn(),
  requestAccountDeletionFor: vi.fn(),
}));
vi.mock('@causedeck/core/runtime', () => runtime);

const SECRET = 'JBSWY3DPEHPK3PXP';
const TOTP_URI = `otpauth://totp/CauseDeck:advocate%40example.in?secret=${SECRET}&issuer=CauseDeck`;

const auth = vi.hoisted(() => ({
  session: null as { session: { id: string }; user: { id: string; name: string } } | null,
  twoFactorEnabled: false,
  updateUser: vi.fn(),
  api: {
    getSession: vi.fn(),
    enableTwoFactor: vi.fn(),
    verifyTOTP: vi.fn(),
    listPasskeys: vi.fn(),
    deletePasskey: vi.fn(),
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
  },
}));
vi.mock('../lib/auth.ts', () => ({
  getSession: () => Promise.resolve(auth.session),
  getAuth: () => ({
    api: auth.api,
    $context: Promise.resolve({ internalAdapter: { updateUser: auth.updateUser } }),
  }),
}));

const {
  deletePasskeyAction,
  enableTwoFactorAction,
  requestAccountDeletionAction,
  revokeSessionAction,
  updateAccountProfileAction,
  verifyTwoFactorAction,
} = await import('../app/(app)/account/actions.ts');

function signIn(name = 'Asha Rao') {
  auth.session = { session: { id: 'session-current' }, user: { id: 'user-1', name } };
}

beforeEach(() => {
  auth.api.getSession.mockImplementation(() =>
    Promise.resolve({ user: { twoFactorEnabled: auth.twoFactorEnabled } }),
  );
  auth.api.enableTwoFactor.mockResolvedValue({
    totpURI: TOTP_URI,
    backupCodes: ['aaaa-1111', 'bbbb-2222'],
  });
  auth.api.listPasskeys.mockResolvedValue([{ id: 'pk-mine', name: 'Laptop' }]);
  auth.api.listSessions.mockResolvedValue([
    { id: 'session-current', token: 'token-current' },
    { id: 'session-phone', token: 'token-phone' },
  ]);
});

afterEach(() => {
  auth.session = null;
  auth.twoFactorEnabled = false;
  vi.clearAllMocks();
});

describe('signed out', () => {
  it.each([
    ['updateAccountProfileAction', () => updateAccountProfileAction({ name: 'X' })],
    ['enableTwoFactorAction', () => enableTwoFactorAction({})],
    ['verifyTwoFactorAction', () => verifyTwoFactorAction({ code: '123456' })],
    ['deletePasskeyAction', () => deletePasskeyAction({ id: 'pk-mine' })],
    ['revokeSessionAction', () => revokeSessionAction({ sessionId: 'session-phone' })],
    ['requestAccountDeletionAction', () => requestAccountDeletionAction({})],
  ])('%s is UNAUTHENTICATED and calls nothing', async (_name, run) => {
    expect(await run()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.api.enableTwoFactor).not.toHaveBeenCalled();
    expect(auth.api.verifyTOTP).not.toHaveBeenCalled();
    expect(auth.api.deletePasskey).not.toHaveBeenCalled();
    expect(auth.api.revokeSession).not.toHaveBeenCalled();
    expect(runtime.requestAccountDeletionFor).not.toHaveBeenCalled();
  });
});

describe('updateAccountProfileAction', () => {
  it('rejects an empty or over-long name (zod)', async () => {
    signIn();
    for (const name of ['   ', 'x'.repeat(121)]) {
      expect(await updateAccountProfileAction({ name })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("renames the caller's own user and records account.profile_updated (fields only)", async () => {
    signIn();
    const result = await updateAccountProfileAction({ name: '  Asha R. Iyer ' });
    expect(result).toEqual({ ok: true, data: { name: 'Asha R. Iyer' } });
    expect(auth.updateUser).toHaveBeenCalledWith('user-1', { name: 'Asha R. Iyer' });
    expect(runtime.recordAccountProfileUpdatedFor).toHaveBeenCalledWith(
      'user-1',
      ['name'],
      expect.objectContaining({ userAgent: 'vitest' }),
    );
  });

  it('an unchanged name writes nothing', async () => {
    signIn('Asha Rao');
    expect(await updateAccountProfileAction({ name: 'Asha Rao' })).toMatchObject({ ok: true });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(runtime.recordAccountProfileUpdatedFor).not.toHaveBeenCalled();
  });
});

describe('enableTwoFactorAction', () => {
  it('returns a QR code (SVG data URL), the key and the backup codes, and logs none of them', async () => {
    signIn();
    const result = await enableTwoFactorAction({});
    if (!result.ok) throw new Error(result.error.code);
    expect(auth.api.enableTwoFactor).toHaveBeenCalledWith({ body: {}, headers: requestHeaders });
    expect(result.data.secret).toBe(SECRET);
    expect(result.data.backupCodes).toEqual(['aaaa-1111', 'bbbb-2222']);
    expect(result.data.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(result.data.qr.split(',')[1] ?? '', 'base64').toString();
    expect(svg).toContain('<svg');
    expect(svg).toContain('#ffffff');
    const logged = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('aaaa-1111');
  });

  it('is CONFLICT when two-factor is already on (the secret is not replaced)', async () => {
    signIn();
    auth.twoFactorEnabled = true;
    expect(await enableTwoFactorAction({})).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(auth.api.enableTwoFactor).not.toHaveBeenCalled();
  });
});

describe('verifyTwoFactorAction', () => {
  it('only accepts six digits', async () => {
    signIn();
    for (const code of ['12345', '1234567', 'abcdef']) {
      expect(await verifyTwoFactorAction({ code })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    expect(auth.api.verifyTOTP).not.toHaveBeenCalled();
  });

  it('verifies and forwards the rotated session cookie', async () => {
    signIn();
    const responseHeaders = new Headers();
    responseHeaders.append(
      'set-cookie',
      'better-auth.session_token=new-token.sig; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000',
    );
    auth.api.verifyTOTP.mockResolvedValue({ headers: responseHeaders, response: {} });
    expect(await verifyTwoFactorAction({ code: '123456' })).toEqual({
      ok: true,
      data: { enabled: true },
    });
    expect(auth.api.verifyTOTP).toHaveBeenCalledWith({
      body: { code: '123456' },
      headers: requestHeaders,
      returnHeaders: true,
    });
    expect(cookieSet).toHaveBeenCalledWith(
      'better-auth.session_token',
      'new-token.sig',
      expect.objectContaining({ path: '/', httpOnly: true, maxAge: 2592000 }),
    );
  });

  it('a wrong code is VALIDATION, not INTERNAL, and is not logged', async () => {
    signIn();
    auth.api.verifyTOTP.mockRejectedValue(
      new APIError('UNAUTHORIZED', { message: 'Invalid code' }),
    );
    expect(await verifyTwoFactorAction({ code: '000000' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe('deletePasskeyAction', () => {
  it("removes one of the caller's own passkeys", async () => {
    signIn();
    expect(await deletePasskeyAction({ id: 'pk-mine' })).toEqual({
      ok: true,
      data: { id: 'pk-mine' },
    });
    expect(auth.api.deletePasskey).toHaveBeenCalledWith({
      body: { id: 'pk-mine' },
      headers: requestHeaders,
    });
  });

  it("is FORBIDDEN for a passkey that is not the caller's", async () => {
    signIn();
    expect(await deletePasskeyAction({ id: 'pk-someone-else' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(auth.api.deletePasskey).not.toHaveBeenCalled();
  });
});

describe('revokeSessionAction', () => {
  it('revokes another of the caller’s sessions by its server-side token', async () => {
    signIn();
    expect(await revokeSessionAction({ sessionId: 'session-phone' })).toEqual({
      ok: true,
      data: { sessionId: 'session-phone' },
    });
    expect(auth.api.revokeSession).toHaveBeenCalledWith({
      body: { token: 'token-phone' },
      headers: requestHeaders,
    });
  });

  it("is FORBIDDEN for a session id that is not the caller's", async () => {
    signIn();
    expect(await revokeSessionAction({ sessionId: 'session-of-user-2' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(auth.api.revokeSession).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN for the current session (sign out instead)', async () => {
    signIn();
    expect(await revokeSessionAction({ sessionId: 'session-current' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(auth.api.revokeSession).not.toHaveBeenCalled();
  });

  it('rejects a missing id (zod)', async () => {
    signIn();
    expect(await revokeSessionAction({ sessionId: '' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });
});
