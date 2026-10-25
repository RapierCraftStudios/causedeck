// WhatsApp link server actions (#681): each runs through `workspaceAction` (zod, session,
// membership), calls `@causedeck/core/whatsapp-link` on the workspace transaction for the signed-in
// member only (the input never names a user), maps core domain errors to action errors and returns
// the masked number only. A refused code is returned as a value so the transaction commits and core's
// attempt count survives.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const OTHER = '00000000-0000-4000-8000-0000000b0102';
const TX = { scoped: true };

const state = vi.hoisted(() => ({
  session: null as AppSession | null,
  role: null as string | null,
  rolledBack: false,
}));

class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

const core = vi.hoisted(() => ({
  requestWhatsAppOtp: vi.fn(),
  verifyWhatsAppOtp: vi.fn(),
  setWhatsAppCategories: vi.fn(),
  unlinkWhatsApp: vi.fn(),
  getWhatsAppLink: vi.fn(),
}));

const withWorkspace = vi.hoisted(() =>
  vi.fn(async (_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    try {
      return await fn(TX);
    } catch (error) {
      state.rolledBack = true;
      throw error;
    }
  }),
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
vi.mock('@causedeck/core/whatsapp-link', () => core);

const actions = await import('../app/(app)/w/[slug]/settings/notifications/whatsapp-actions.ts');

const actor = { userId: USER, workspaceId: WS };
const view = {
  maskedNumber: '••••5678',
  verifiedAt: new Date('2026-10-24T10:00:00Z'),
  consentAt: new Date('2026-10-24T09:59:00Z'),
  categories: ['court.board'],
};
const state_ = {
  maskedNumber: '••••5678',
  verifiedAt: '2026-10-24T10:00:00.000Z',
  consentAt: '2026-10-24T09:59:00.000Z',
  categories: ['court.board'],
};

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Asha', email: 'a@x.test' },
  } as AppSession;
  state.role = 'junior';
  state.rolledBack = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('guards', () => {
  it('rejects a non-member with FORBIDDEN before any core call', async () => {
    state.role = null;
    const result = await actions.unlinkWhatsAppAction({ workspaceId: WS });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(core.unlinkWhatsApp).not.toHaveBeenCalled();
  });

  it('rejects a signed-out caller as UNAUTHENTICATED', async () => {
    state.session = null;
    expect(await actions.getWhatsAppLinkAction({ workspaceId: WS })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('validates input: code shape, categories type, consent type', async () => {
    for (const [action, input] of [
      [actions.verifyWhatsAppOtpAction, { workspaceId: WS, code: '12ab56' }],
      [actions.setWhatsAppCategoriesAction, { workspaceId: WS, categories: 'court.board' }],
      [
        actions.requestWhatsAppOtpAction,
        { workspaceId: WS, e164: '+919812345678', consent: 'yes' },
      ],
    ] as const) {
      expect(await action(input), JSON.stringify(input)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    expect(core.verifyWhatsAppOtp).not.toHaveBeenCalled();
    expect(core.setWhatsAppCategories).not.toHaveBeenCalled();
    expect(core.requestWhatsAppOtp).not.toHaveBeenCalled();
  });
});

describe('actions', () => {
  it('always acts for the signed-in member, never a user named in the input', async () => {
    core.requestWhatsAppOtp.mockResolvedValue({ expiresAt: new Date('2026-10-24T10:10:00Z') });
    const result = await actions.requestWhatsAppOtpAction({
      workspaceId: WS,
      e164: '+919812345678',
      consent: true,
      userId: OTHER,
    });
    expect(result).toEqual({ ok: true, data: { expiresAt: '2026-10-24T10:10:00.000Z' } });
    expect(core.requestWhatsAppOtp).toHaveBeenCalledWith({ db: TX }, actor, {
      e164: '+919812345678',
      consent: true,
    });
  });

  it('verifies a code and returns only the masked number', async () => {
    core.verifyWhatsAppOtp.mockResolvedValue(view);
    expect(await actions.verifyWhatsAppOtpAction({ workspaceId: WS, code: '123456' })).toEqual({
      ok: true,
      data: state_,
    });
    expect(core.verifyWhatsAppOtp).toHaveBeenCalledWith({ db: TX }, actor, { code: '123456' });
  });

  it('sets categories, unlinks and reads the link', async () => {
    core.setWhatsAppCategories.mockResolvedValue(view);
    core.getWhatsAppLink.mockResolvedValueOnce(view).mockResolvedValueOnce(null);
    expect(
      await actions.setWhatsAppCategoriesAction({ workspaceId: WS, categories: ['court.board'] }),
    ).toEqual({ ok: true, data: state_ });
    expect(await actions.unlinkWhatsAppAction({ workspaceId: WS })).toEqual({
      ok: true,
      data: { unlinked: true },
    });
    expect(core.unlinkWhatsApp).toHaveBeenCalledWith({ db: TX }, actor);
    expect(await actions.getWhatsAppLinkAction({ workspaceId: WS })).toEqual({
      ok: true,
      data: state_,
    });
    expect(await actions.getWhatsAppLinkAction({ workspaceId: WS })).toEqual({
      ok: true,
      data: null,
    });
  });
});

describe('errors', () => {
  it('maps core domain errors to action errors (rate limit reads as CONFLICT)', async () => {
    for (const [code, expected] of [
      ['VALIDATION', 'VALIDATION'],
      ['CONFLICT', 'CONFLICT'],
      ['RATE_LIMITED', 'CONFLICT'],
    ] as const) {
      core.requestWhatsAppOtp.mockRejectedValueOnce(new DomainError(code, 'nope'));
      expect(
        await actions.requestWhatsAppOtpAction({
          workspaceId: WS,
          e164: '+919812345678',
          consent: false,
        }),
      ).toMatchObject({ ok: false, error: { code: expected } });
    }
  });

  it('a wrong code is an error result but does not roll the transaction back', async () => {
    core.verifyWhatsAppOtp.mockRejectedValue(
      new DomainError('VALIDATION', 'That code is not right'),
    );
    const result = await actions.verifyWhatsAppOtpAction({ workspaceId: WS, code: '000000' });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: 'That code is not right' },
    });
    expect(state.rolledBack).toBe(false);
  });
});
