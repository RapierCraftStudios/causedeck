// The `/invite/<token>` accept action (#180, #203): it installs the billing seat gate before
// accepting, and a workspace with no seat left comes back as a typed `SEAT_LIMIT` rejection.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = { user: { id: '00000000-0000-4000-8000-0000000b0101', email: 'a@x.test' } };
const acceptInvitation = vi.hoisted(() => vi.fn());
const installBillingEntitlements = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth.ts', () => ({ requireSession: () => Promise.resolve(session) }));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' } }));
vi.mock('@causedeck/core/workspaces', () => ({ acceptInvitation }));
vi.mock('@causedeck/core/billing', () => ({ installBillingEntitlements }));

const { acceptInvitationAction } = await import('../app/(public)/invite/[token]/actions.ts');

const TOKEN = 'a'.repeat(43);

beforeEach(() => {
  acceptInvitation.mockReset();
  installBillingEntitlements.mockReset();
});

describe('acceptInvitationAction', () => {
  it('installs the seat gate and accepts', async () => {
    acceptInvitation.mockResolvedValue({ workspaceSlug: 'hebbal', role: 'junior' });
    const result = await acceptInvitationAction({ token: TOKEN });
    expect(installBillingEntitlements).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      data: { status: 'accepted', slug: 'hebbal', next: '/w/hebbal/today' },
    });
  });

  it('sends an accepted clerk to the clerk-led setup (#505)', async () => {
    acceptInvitation.mockResolvedValue({ workspaceSlug: 'hebbal', role: 'clerk' });
    const result = await acceptInvitationAction({ token: TOKEN });
    expect(result).toEqual({
      ok: true,
      data: { status: 'accepted', slug: 'hebbal', next: '/w/hebbal/welcome' },
    });
  });

  it('maps ENTITLEMENT_EXCEEDED to a SEAT_LIMIT rejection', async () => {
    acceptInvitation.mockRejectedValue(
      Object.assign(new Error('no seats'), {
        name: 'EntitlementError',
        code: 'ENTITLEMENT_EXCEEDED',
        key: 'seats',
        limit: 3,
      }),
    );
    const result = await acceptInvitationAction({ token: TOKEN });
    expect(result).toEqual({ ok: true, data: { status: 'rejected', reason: 'SEAT_LIMIT' } });
  });
});
