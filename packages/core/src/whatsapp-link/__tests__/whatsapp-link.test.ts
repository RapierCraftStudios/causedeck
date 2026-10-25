// WhatsApp number link (#678, D-029): opt-in and verification before any message, unlink stops
// messages, OTP expiry, attempt cap and cooldown, and a send target only for the owning user.
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { schema, type Transaction } from '@causedeck/db';
import { describe, expect, it } from 'vitest';

import type { WorkspaceError } from '../../shared/errors.ts';
import {
  WHATSAPP_OTP_MAX_ATTEMPTS,
  WHATSAPP_OTP_RESEND_COOLDOWN_MS,
  WHATSAPP_OTP_TTL_MS,
  getWhatsAppLink,
  getWhatsAppSendTarget,
  requestWhatsAppOtp,
  setWhatsAppCategories,
  unlinkWhatsApp,
  verifyWhatsAppOtp,
} from '../index.ts';

const NUMBER = '+919812345678';
const T0 = new Date('2026-11-01T10:00:00Z');

async function setup(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  await withTestDb(async (tx) => {
    const seeded = await seedTwoTenants(tx);
    // The seeders already linked the owners; start each case from a clean slate.
    await inWorkspace(tx, seeded.a.id, async (s) => {
      await s.delete(schema.whatsappLink);
      await s.delete(schema.whatsappOtpChallenge);
    });
    const sent: { e164: string; code: string }[] = [];
    let clock = T0;
    const deps = {
      db: tx,
      sendOtp: (e164: string, code: string) => {
        sent.push({ e164, code });
        return Promise.resolve();
      },
      now: () => clock,
      generateCode: () => '424242',
    };
    await fn({
      tx,
      deps,
      sent,
      actor: { userId: seeded.ua, workspaceId: seeded.a.id },
      other: { userId: seeded.ub, workspaceId: seeded.b.id },
      advance: (ms) => {
        clock = new Date(clock.getTime() + ms);
      },
    });
  });
}

interface Ctx {
  tx: Transaction;
  deps: Parameters<typeof requestWhatsAppOtp>[0];
  sent: { e164: string; code: string }[];
  actor: { userId: string; workspaceId: string };
  other: { userId: string; workspaceId: string };
  advance: (ms: number) => void;
}

const code = (error: unknown) => (error as WorkspaceError).code;
const fails = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

describe('whatsapp link (#678)', () => {
  it('sends no target before verification and requires the opt-in', () =>
    setup(async ({ deps, actor, sent }) => {
      expect(await getWhatsAppSendTarget(deps, actor)).toBeNull();
      const refused = await fails(
        requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: false }),
      );
      expect(code(refused)).toBe('VALIDATION');
      expect(sent).toEqual([]);
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      expect(sent).toEqual([{ e164: NUMBER, code: '424242' }]);
      // A pending challenge is not a link.
      expect(await getWhatsAppSendTarget(deps, actor)).toBeNull();
      expect(await getWhatsAppLink(deps, actor)).toBeNull();
    }));

  it('rejects a number that is not E.164', () =>
    setup(async ({ deps, actor }) => {
      for (const bad of ['9812345678', '+0123456789', '+91abc', '+12']) {
        const e = await fails(requestWhatsAppOtp(deps, actor, { e164: bad, consent: true }));
        expect(code(e), bad).toBe('VALIDATION');
      }
    }));

  it('stores only a hash of the code', () =>
    setup(async ({ deps, actor, tx }) => {
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      const rows = await inWorkspace(tx, actor.workspaceId, (s) =>
        s.select().from(schema.whatsappOtpChallenge),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.codeHash).not.toContain('424242');
      expect(rows[0]?.expiresAt.getTime()).toBe(T0.getTime() + WHATSAPP_OTP_TTL_MS);
    }));

  it('verifies, links the number, and targets only the owner', () =>
    setup(async ({ deps, actor, other }) => {
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      const link = await verifyWhatsAppOtp(deps, actor, { code: '424242' });
      expect(link.maskedNumber).toBe('••••5678');
      expect(link.consentAt).toEqual(T0);
      expect(await getWhatsAppSendTarget(deps, actor)).toEqual({ e164: NUMBER });
      // Another user, or the same user in another workspace, never gets this number.
      expect(await getWhatsAppSendTarget(deps, other)).not.toEqual({ e164: NUMBER });
      expect(
        await getWhatsAppSendTarget(deps, { userId: other.userId, workspaceId: actor.workspaceId }),
      ).toBeNull();
      // The challenge is consumed: the same code cannot be replayed.
      const replay = await fails(verifyWhatsAppOtp(deps, actor, { code: '424242' }));
      expect(code(replay)).toBe('NOT_FOUND');
    }));

  it('counts wrong codes and locks the challenge at the attempt cap', () =>
    setup(async ({ deps, actor }) => {
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      for (let i = 0; i < WHATSAPP_OTP_MAX_ATTEMPTS; i += 1) {
        const e = await fails(verifyWhatsAppOtp(deps, actor, { code: '000000' }));
        expect(code(e)).toBe('VALIDATION');
      }
      // Even the right code is refused once the cap is reached.
      const locked = await fails(verifyWhatsAppOtp(deps, actor, { code: '424242' }));
      expect(code(locked)).toBe('VALIDATION');
      expect(await getWhatsAppSendTarget(deps, actor)).toBeNull();
    }));

  it('refuses an expired code', () =>
    setup(async ({ deps, actor, advance }) => {
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      advance(WHATSAPP_OTP_TTL_MS + 1);
      const e = await fails(verifyWhatsAppOtp(deps, actor, { code: '424242' }));
      expect(code(e)).toBe('VALIDATION');
      expect(await getWhatsAppSendTarget(deps, actor)).toBeNull();
    }));

  it('limits how often a code can be requested', () =>
    setup(async ({ deps, actor, advance, sent }) => {
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      const e = await fails(requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true }));
      expect(code(e)).toBe('RATE_LIMITED');
      advance(WHATSAPP_OTP_RESEND_COOLDOWN_MS);
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      expect(sent).toHaveLength(2);
    }));

  it('sends categories only once linked and only the chosen ones', () =>
    setup(async ({ deps, actor }) => {
      const early = await fails(
        setWhatsAppCategories(deps, actor, { categories: ['court.board'] }),
      );
      expect(code(early)).toBe('CONFLICT');
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      await verifyWhatsAppOtp(deps, actor, { code: '424242' });
      const unknown = await fails(setWhatsAppCategories(deps, actor, { categories: ['nope'] }));
      expect(code(unknown)).toBe('VALIDATION');
      const link = await setWhatsAppCategories(deps, actor, { categories: ['court.board'] });
      expect(link.categories).toEqual(['court.board']);
      expect(await getWhatsAppSendTarget(deps, actor, { category: 'court.board' })).toEqual({
        e164: NUMBER,
      });
      expect(await getWhatsAppSendTarget(deps, actor, { category: 'proposal.new' })).toBeNull();
    }));

  it('stops all messages after unlink, and unlinking twice is fine', () =>
    setup(async ({ deps, actor, tx }) => {
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      await verifyWhatsAppOtp(deps, actor, { code: '424242' });
      await requestWhatsAppOtp(deps, actor, { e164: '+919800000002', consent: true }).catch(
        () => undefined,
      );
      await unlinkWhatsApp(deps, actor);
      await unlinkWhatsApp(deps, actor);
      expect(await getWhatsAppSendTarget(deps, actor)).toBeNull();
      expect(await getWhatsAppLink(deps, actor)).toBeNull();
      const left = await inWorkspace(tx, actor.workspaceId, async (s) => ({
        links: await s.select().from(schema.whatsappLink),
        challenges: await s.select().from(schema.whatsappOtpChallenge),
      }));
      expect(left).toEqual({ links: [], challenges: [] });
    }));

  it('drops the challenge when the code cannot be delivered', () =>
    setup(async ({ deps, actor, tx }) => {
      const failing = { ...deps, sendOtp: () => Promise.reject(new Error('provider down')) };
      await expect(
        requestWhatsAppOtp(failing, actor, { e164: NUMBER, consent: true }),
      ).rejects.toThrow('We could not send the code');
      const rows = await inWorkspace(tx, actor.workspaceId, (s) =>
        s.select().from(schema.whatsappOtpChallenge),
      );
      expect(rows).toEqual([]);
    }));
});
