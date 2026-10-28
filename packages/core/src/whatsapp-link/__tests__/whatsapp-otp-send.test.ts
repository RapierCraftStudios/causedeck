// The link code is actually delivered (#711): one send per request through the mock provider, wrong
// codes are counted, sends are limited per number and per member, and neither logs nor audit rows
// hold the code or the number. Code storage, expiry and attempt cap are covered in whatsapp-link.test.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createWhatsAppOtpSender, mockWhatsAppOtpSender } from '@causedeck/notifications/whatsapp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceError } from '../../shared/errors.ts';
import {
  WHATSAPP_OTP_MEMBER_LIMIT,
  WHATSAPP_OTP_NUMBER_LIMIT,
  WHATSAPP_OTP_RESEND_COOLDOWN_MS,
  requestWhatsAppOtp,
  verifyWhatsAppOtp,
} from '../index.ts';

const NUMBER = '+919812345678';
const CODE = '424242';
const T0 = new Date('2026-11-01T10:00:00Z');

afterEach(() => vi.restoreAllMocks());

async function setup(
  fn: (ctx: {
    deps: Parameters<typeof requestWhatsAppOtp>[0];
    mock: ReturnType<typeof mockWhatsAppOtpSender>;
    actor: { userId: string; workspaceId: string };
    other: { userId: string; workspaceId: string };
    advance: (ms: number) => void;
    tx: Parameters<Parameters<typeof withTestDb>[0]>[0];
  }) => Promise<void>,
  sender: (
    mock: ReturnType<typeof mockWhatsAppOtpSender>,
  ) => (e: string, c: string) => Promise<void> = (mock) => async (e164, code) => {
    await mock.sendOtp({ code, expiresInMinutes: 10 }, { e164 });
  },
) {
  await withTestDb(async (tx) => {
    const seeded = await seedTwoTenants(tx);
    await inWorkspace(tx, seeded.a.id, async (s) => {
      await s.delete(schema.whatsappLink);
      await s.delete(schema.whatsappOtpChallenge);
    });
    const mock = mockWhatsAppOtpSender();
    let clock = T0;
    await fn({
      tx,
      mock,
      deps: { db: tx, sendOtp: sender(mock), now: () => clock, generateCode: () => CODE },
      actor: { userId: seeded.ua, workspaceId: seeded.a.id },
      other: { userId: seeded.ub, workspaceId: seeded.b.id },
      advance: (ms) => {
        clock = new Date(clock.getTime() + ms);
      },
    });
  });
}

const fails = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );
const code = (e: unknown) => (e as WorkspaceError).code;

describe('whatsapp link code delivery (#711)', () => {
  it('a link request sends exactly one code through the provider', () =>
    setup(async ({ deps, actor, mock }) => {
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      expect(mock.outbox).toEqual([{ e164: NUMBER, code: CODE, expiresInMinutes: 10 }]);
      expect((await verifyWhatsAppOtp(deps, actor, { code: CODE })).maskedNumber).toBe('••••5678');
      expect(mock.outbox).toHaveLength(1);
    }));

  it('a refused request (no consent, bad number) sends nothing', () =>
    setup(async ({ deps, actor, mock }) => {
      await fails(requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: false }));
      await fails(requestWhatsAppOtp(deps, actor, { e164: '12345', consent: true }));
      expect(mock.outbox).toEqual([]);
    }));

  it('a wrong code fails and is counted, and does not link', () =>
    setup(async ({ deps, actor, tx }) => {
      await requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true });
      expect(code(await fails(verifyWhatsAppOtp(deps, actor, { code: '000000' })))).toBe(
        'VALIDATION',
      );
      expect(code(await fails(verifyWhatsAppOtp(deps, actor, { code: '111111' })))).toBe(
        'VALIDATION',
      );
      const [row] = await inWorkspace(tx, actor.workspaceId, (s) =>
        s.select().from(schema.whatsappOtpChallenge),
      );
      expect(row?.attempts).toBe(2);
      const links = await inWorkspace(tx, actor.workspaceId, (s) =>
        s.select().from(schema.whatsappLink),
      );
      expect(links).toEqual([]);
    }));

  it('limits sends per number, across members', () =>
    setup(async ({ deps, actor, other, advance, mock }) => {
      const who = [actor, other];
      for (let i = 0; i < WHATSAPP_OTP_NUMBER_LIMIT.max; i += 1) {
        advance(WHATSAPP_OTP_RESEND_COOLDOWN_MS);
        await requestWhatsAppOtp(deps, who[i % 2] ?? actor, { e164: NUMBER, consent: true });
      }
      advance(WHATSAPP_OTP_RESEND_COOLDOWN_MS);
      const e = await fails(requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true }));
      expect(code(e)).toBe('RATE_LIMITED');
      expect(mock.outbox).toHaveLength(WHATSAPP_OTP_NUMBER_LIMIT.max);
    }));

  it('limits sends per member, whatever the number', () =>
    setup(async ({ deps, actor, advance, mock }) => {
      for (let i = 0; i < WHATSAPP_OTP_MEMBER_LIMIT.max; i += 1) {
        advance(WHATSAPP_OTP_RESEND_COOLDOWN_MS);
        const e164 = `+91981234${String(1000 + i)}`;
        await requestWhatsAppOtp(deps, actor, { e164, consent: true });
      }
      advance(WHATSAPP_OTP_RESEND_COOLDOWN_MS);
      const e = await fails(
        requestWhatsAppOtp(deps, actor, { e164: '+919899999999', consent: true }),
      );
      expect(code(e)).toBe('RATE_LIMITED');
      expect(mock.outbox).toHaveLength(WHATSAPP_OTP_MEMBER_LIMIT.max);
    }));

  it('a provider failure leaves no pending challenge and no detail in the error', () =>
    setup(
      async ({ deps, actor, tx }) => {
        const e = await fails(requestWhatsAppOtp(deps, actor, { e164: NUMBER, consent: true }));
        expect(code(e)).toBe('CONFLICT');
        expect((e as Error).message).not.toContain(CODE);
        expect(
          await inWorkspace(tx, actor.workspaceId, (s) =>
            s.select().from(schema.whatsappOtpChallenge),
          ),
        ).toEqual([]);
      },
      () => () => Promise.reject(new Error('provider down')),
    ));

  it('never writes the code to logs, and audit rows hold ids only', () =>
    setup(async ({ deps, actor, tx }) => {
      const out: string[] = [];
      for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          out.push(JSON.stringify(args));
        });
      }
      const logged: string[] = [];
      const log = {
        info: (o: object, m?: string) => logged.push(JSON.stringify([o, m])),
        warn: (o: object, m?: string) => logged.push(JSON.stringify([o, m])),
      };
      const sender = createWhatsAppOtpSender({ env: { NODE_ENV: 'development' }, log });
      const send = async (e164: string, c: string) => {
        await sender.sendOtp({ code: c, expiresInMinutes: 10 }, { e164 });
      };
      const live = { ...deps, sendOtp: send };
      await requestWhatsAppOtp(live, actor, { e164: NUMBER, consent: true });
      await fails(verifyWhatsAppOtp(live, actor, { code: '000000' }));
      await verifyWhatsAppOtp(live, actor, { code: CODE });
      expect(logged.length).toBeGreaterThan(0);
      for (const line of [...logged, ...out]) {
        expect(line).not.toContain(CODE);
        expect(line).not.toContain(NUMBER);
      }
      const audit = await inWorkspace(tx, actor.workspaceId, (s) =>
        s.select().from(schema.auditEvent),
      );
      const mine = audit.filter((r) => r.action.startsWith('whatsapp.'));
      expect(mine.map((r) => r.action).sort()).toEqual([
        'whatsapp.linked',
        'whatsapp.otp_failed',
        'whatsapp.otp_requested',
      ]);
      for (const row of mine) {
        const text = JSON.stringify([row.metadata, row.targetKind, row.targetId]);
        expect(text).not.toContain(CODE);
        expect(text).not.toContain('000000');
        expect(text).not.toContain('9812345678');
      }
    }));
});
