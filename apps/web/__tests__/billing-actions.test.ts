// Billing page server actions (#257): each runs through `workspaceAction` with the owner-only
// `billing.manage` permission, calls the core subscription actions on the workspace-scoped
// transaction and maps known billing failures to typed errors for the dialogs.
import type { AppSession } from '../lib/auth.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const TX = { scoped: true };
const SLUG = 'iyer-chambers';

const state = vi.hoisted(
  (): { session: AppSession | null; role: string | null; roleGrantedAt: Date } => ({
    session: null,
    role: 'owner',
    roleGrantedAt: new Date(),
  }),
);

class NamedError extends Error {
  constructor(name: string, extra: Record<string, unknown> = {}) {
    super(name);
    this.name = name;
    Object.assign(this, extra);
  }
}

const core = vi.hoisted(() => ({
  memberRole: vi.fn(() => Promise.resolve(state.role)),
  // The owner 2FA grace (#290): the session has no 2FA, so the grant time decides.
  ownerGrace: vi.fn(() =>
    Promise.resolve(state.role ? { role: state.role, roleGrantedAt: state.roleGrantedAt } : null),
  ),
}));
const billing = vi.hoisted(() => ({
  quoteSubscriptionChange: vi.fn(),
  changeSubscriptionSeats: vi.fn(() => Promise.resolve({ subscription: {}, charge: null })),
  changeSubscriptionPlan: vi.fn(() => Promise.resolve({ subscription: {}, charge: null })),
  cancelSubscriptionAtPeriodEnd: vi.fn(() => Promise.resolve({ subscription: {}, charge: null })),
  resumeSubscription: vi.fn(() => Promise.resolve({ subscription: {}, charge: null })),
  setSubscriptionGstin: vi.fn(),
  startSubscriptionCheckout: vi.fn(),
  updateSubscriptionPaymentMethod: vi.fn(),
}));
const billingServiceFor = vi.hoisted(() => vi.fn());
const completeMandate = vi.hoisted(() => vi.fn());
const billingFlowFor = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({ service: { fake: 'service' }, providerName: 'mock', completeMandate }),
  ),
);
const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
);
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth.ts', () => ({
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
}));
vi.mock('../lib/billing-provider.ts', () => ({ billingServiceFor, billingFlowFor }));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/core/workspaces', () => core);
vi.mock('@causedeck/core/billing', () => billing);
vi.mock('next/cache', () => ({ revalidatePath }));

const actions = await import('../app/(app)/w/[slug]/billing/actions.ts');
const { gstinCheckDigit } = await import('@causedeck/billing/gstin');

const GSTIN = `27AAPFU0939F1Z${gstinCheckDigit('27AAPFU0939F1Z')}`;
const ctx = { tx: TX, workspaceId: WS, actorUserId: USER, service: billingServiceFor };

const calls = {
  quoteChange: () =>
    actions.quoteChange({ workspaceId: WS, planId: 'chamber-seat-2', seats: 3, clerkSeats: 0 }),
  changeSeats: () => actions.changeSeats({ workspaceId: WS, slug: SLUG, seats: 4, clerkSeats: 1 }),
  changePlan: () =>
    actions.changePlan({
      workspaceId: WS,
      slug: SLUG,
      planId: 'chamber-seat-2',
      seats: 3,
      clerkSeats: 0,
    }),
  cancelAtPeriodEnd: () => actions.cancelAtPeriodEnd({ workspaceId: WS, slug: SLUG }),
  resumeSubscription: () => actions.resumeSubscription({ workspaceId: WS, slug: SLUG }),
  saveGstin: () => actions.saveGstin({ workspaceId: WS, slug: SLUG, gstin: GSTIN }),
  startCheckout: () =>
    actions.startCheckout({ workspaceId: WS, slug: SLUG, planId: 'advocate-monthly-1', seats: 1 }),
  updatePaymentMethod: () => actions.updatePaymentMethod({ workspaceId: WS, slug: SLUG }),
};

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Meenakshi', email: 'm@x.test' },
  } as AppSession;
  state.role = 'owner';
  state.roleGrantedAt = new Date();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('billing.manage guard', () => {
  it.each(['advocate', 'junior', 'clerk', 'viewer'])(
    'rejects a %s with FORBIDDEN on every action, before any billing call',
    async (role) => {
      state.role = role;
      for (const call of Object.values(calls)) {
        expect(await call()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      }
      for (const fn of Object.values(billing)) expect(fn).not.toHaveBeenCalled();
      expect(withWorkspace).not.toHaveBeenCalled();
    },
  );

  it('rejects an owner without 2FA after the 7-day grace with FORBIDDEN on every action (#290)', async () => {
    state.roleGrantedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    for (const call of Object.values(calls)) {
      expect(await call()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    for (const fn of Object.values(billing)) expect(fn).not.toHaveBeenCalled();
    expect(withWorkspace).not.toHaveBeenCalled();
  });

  it('lets an owner with 2FA through after the grace (#290)', async () => {
    state.roleGrantedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    state.session = {
      session: {},
      user: { id: USER, name: 'Meenakshi', email: 'm@x.test', twoFactorEnabled: true },
    } as unknown as AppSession;
    expect(await calls.cancelAtPeriodEnd()).toMatchObject({ ok: true });
    expect(core.ownerGrace).not.toHaveBeenCalled();
  });

  it('rejects a signed-out caller as UNAUTHENTICATED', async () => {
    state.session = null;
    expect(await calls.changeSeats()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});

describe('quoteChange', () => {
  it('returns the summary with GST at 18% and the GST-inclusive total', async () => {
    billing.quoteSubscriptionChange.mockResolvedValue({
      basePaise: 194_700,
      gstPaise: 35_046,
      totalPaise: 229_746,
      prorationPaise: 30_484,
      prorationGstPaise: 5_487,
      prorationTotalPaise: 35_971,
      effective: 'now',
      effectiveDate: new Date('2026-01-11T00:00:00Z'),
    });
    const result = await calls.quoteChange();
    expect(billing.quoteSubscriptionChange).toHaveBeenCalledWith(TX, WS, {
      planId: 'chamber-seat-2',
      seats: 3,
      clerkSeats: 0,
    });
    if (!result.ok || result.data.error) throw new Error('expected a quote');
    const { quote } = result.data;
    expect(quote.basePaise + quote.gstPaise).toBe(quote.totalPaise);
    expect(quote.gstPaise).toBe(Math.round(quote.basePaise * 0.18));
    expect(quote.prorationPaise + quote.prorationGstPaise).toBe(quote.prorationTotalPaise);
    expect(quote.formatted).toMatchObject({
      base: '₹1,947.00',
      gst: '₹350.46',
      total: '₹2,297.46',
      proration: '₹304.84',
      prorationTotal: '₹359.71',
      effectiveDate: '11 Jan 2026',
    });
    expect(quote.effective).toBe('now');
  });

  it('maps an invalid target plan to invalid', async () => {
    billing.quoteSubscriptionChange.mockRejectedValue(
      new NamedError('WorkspaceError', { code: 'VALIDATION' }),
    );
    expect(await calls.quoteChange()).toEqual({ ok: true, data: { error: 'invalid' } });
  });
});

describe('changes', () => {
  it('changes seats and plan on the workspace transaction and revalidates the page', async () => {
    expect(await calls.changeSeats()).toEqual({ ok: true, data: {} });
    expect(billing.changeSubscriptionSeats).toHaveBeenCalledWith(ctx, { seats: 4, clerkSeats: 1 });
    expect(await calls.changePlan()).toEqual({ ok: true, data: {} });
    expect(billing.changeSubscriptionPlan).toHaveBeenCalledWith(ctx, {
      planId: 'chamber-seat-2',
      seats: 3,
      clerkSeats: 0,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/w/${SLUG}/billing`);
  });

  it('cancels at period end and resumes', async () => {
    expect(await calls.cancelAtPeriodEnd()).toEqual({ ok: true, data: {} });
    expect(billing.cancelSubscriptionAtPeriodEnd).toHaveBeenCalledWith(ctx);
    expect(await calls.resumeSubscription()).toEqual({ ok: true, data: {} });
    expect(billing.resumeSubscription).toHaveBeenCalledWith(ctx);
  });

  it.each([
    ['BillingServiceError', {}, 'invalid'],
    ['IllegalTransitionError', {}, 'notAllowed'],
    ['BillingProviderError', { code: 'unsupported' }, 'unsupported'],
    ['BillingProviderError', { code: 'invalid_state' }, 'notAllowed'],
  ])('maps %s %o to %s', async (name, extra, error) => {
    billing.resumeSubscription.mockRejectedValueOnce(new NamedError(name, extra));
    expect(await calls.resumeSubscription()).toEqual({ ok: true, data: { error } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure', async () => {
    billing.cancelSubscriptionAtPeriodEnd.mockRejectedValueOnce(new Error('db down'));
    const result = await calls.cancelAtPeriodEnd();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('db down');
  });
});

describe('saveGstin', () => {
  it('returns the normalised GSTIN', async () => {
    billing.setSubscriptionGstin.mockResolvedValue(GSTIN);
    const result = await actions.saveGstin({
      workspaceId: WS,
      slug: SLUG,
      gstin: ` ${GSTIN.toLowerCase()} `,
    });
    expect(billing.setSubscriptionGstin).toHaveBeenCalledWith(ctx, ` ${GSTIN.toLowerCase()} `);
    expect(result).toEqual({ ok: true, data: { gstin: GSTIN } });
    expect(revalidatePath).toHaveBeenCalledWith(`/w/${SLUG}/billing`);
  });

  it.each([
    ['27AAPFU', 'invalidGstinFormat'],
    [`${GSTIN.slice(0, 14)}${GSTIN.endsWith('A') ? 'B' : 'A'}`, 'invalidGstinChecksum'],
  ])('types the error for %s as %s', async (gstin, error) => {
    billing.setSubscriptionGstin.mockRejectedValue(new NamedError('InvalidGstinError'));
    const result = await actions.saveGstin({ workspaceId: WS, slug: SLUG, gstin });
    expect(result).toEqual({ ok: true, data: { error } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('startCheckout and updatePaymentMethod (#1072)', () => {
  it('starts the checkout on the workspace transaction with the owner as billing contact', async () => {
    billing.startSubscriptionCheckout.mockResolvedValue({ mandateUrl: null, activated: true });
    expect(await calls.startCheckout()).toEqual({ ok: true, data: { mandateUrl: null } });
    expect(billing.startSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        tx: TX,
        workspaceId: WS,
        actorUserId: USER,
        billingEmail: 'm@x.test',
        providerName: 'mock',
        completeMandate,
      }),
      { planId: 'advocate-monthly-1', seats: 1, clerkSeats: 0 },
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/w/${SLUG}/billing`);
  });

  it('returns the hosted mandate link for a provider that does not complete it', async () => {
    billing.startSubscriptionCheckout.mockResolvedValue({
      mandateUrl: 'https://rzp.io/i/x',
      activated: false,
    });
    expect(await calls.startCheckout()).toEqual({
      ok: true,
      data: { mandateUrl: 'https://rzp.io/i/x' },
    });
  });

  it('updates the payment method on the workspace transaction', async () => {
    billing.updateSubscriptionPaymentMethod.mockResolvedValue({
      mandateUrl: null,
      completed: true,
    });
    expect(await calls.updatePaymentMethod()).toEqual({ ok: true, data: { mandateUrl: null } });
    expect(billing.updateSubscriptionPaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({ tx: TX, workspaceId: WS, actorUserId: USER, completeMandate }),
    );
  });

  it('answers a demo workspace (FORBIDDEN from the guard) with the demo error as data', async () => {
    billing.startSubscriptionCheckout.mockRejectedValueOnce(
      new NamedError('WorkspaceError', { code: 'FORBIDDEN' }),
    );
    expect(await calls.startCheckout()).toEqual({ ok: true, data: { error: 'demo' } });
    billing.updateSubscriptionPaymentMethod.mockRejectedValueOnce(
      new NamedError('WorkspaceError', { code: 'FORBIDDEN' }),
    );
    expect(await calls.updatePaymentMethod()).toEqual({ ok: true, data: { error: 'demo' } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('maps an existing subscription and an unsupported provider to typed errors', async () => {
    billing.startSubscriptionCheckout.mockRejectedValueOnce(
      new NamedError('WorkspaceError', { code: 'VALIDATION' }),
    );
    expect(await calls.startCheckout()).toEqual({ ok: true, data: { error: 'invalid' } });
    billing.updateSubscriptionPaymentMethod.mockRejectedValueOnce(
      new NamedError('BillingProviderError', { code: 'unsupported' }),
    );
    expect(await calls.updatePaymentMethod()).toEqual({ ok: true, data: { error: 'unsupported' } });
  });
});
