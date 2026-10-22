import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { describe, expect, it } from 'vitest';

import { createMockBillingProvider, signMockDelivery } from '../provider';
import {
  isWithinReplayWindow,
  minimiseWebhookEvent,
  MOCK_WEBHOOK_SECRET,
  signRazorpayWebhook,
  verifyRazorpaySignature,
  webhookSecretFor,
} from '../webhook';

const SECRET = new Secret('whsec-test-0123456789');
const BODY = '{"entity":"event","event":"subscription.charged","created_at":1767225600}';
const hmac = (body: string, key: string) =>
  createHmac('sha256', key).update(body, 'utf8').digest('hex');

describe('verifyRazorpaySignature', () => {
  it('accepts the hex HMAC-SHA256 of the raw body, in either case', () => {
    const signature = hmac(BODY, 'whsec-test-0123456789');
    expect(signRazorpayWebhook(BODY, SECRET)).toBe(signature);
    expect(verifyRazorpaySignature(BODY, signature, SECRET)).toBe(true);
    expect(verifyRazorpaySignature(BODY, signature.toUpperCase(), SECRET)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret and a re-serialised body', () => {
    const signature = signRazorpayWebhook(BODY, SECRET);
    expect(verifyRazorpaySignature(BODY.replace('charged', 'halted'), signature, SECRET)).toBe(
      false,
    );
    expect(verifyRazorpaySignature(BODY, signature, new Secret('another-secret'))).toBe(false);
    const reformatted = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(verifyRazorpaySignature(reformatted, signature, SECRET)).toBe(false);
  });

  it('rejects missing, empty, non-hex and wrong-length signatures without throwing', () => {
    const signature = signRazorpayWebhook(BODY, SECRET);
    for (const bad of [
      undefined,
      null,
      '',
      'not-a-signature',
      'z'.repeat(64),
      signature.slice(0, 62),
      `${signature}00`,
      ` ${signature}`,
    ]) {
      expect(verifyRazorpaySignature(BODY, bad, SECRET)).toBe(false);
    }
  });

  it('compares with crypto.timingSafeEqual, never string equality', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '..', 'webhook.ts'), 'utf8');
    const verify = source.slice(source.indexOf('export function verifyRazorpaySignature'));
    const body = verify.slice(0, verify.indexOf('\n}\n'));
    expect(body).toContain('timingSafeEqual(');
    expect(body).not.toMatch(/===\s*signature|signature\s*===/);
  });
});

describe('webhookSecretFor', () => {
  it('uses RAZORPAY_WEBHOOK_SECRET for razorpay and the mock secret for the mock', () => {
    expect(
      webhookSecretFor({
        BILLING_PROVIDER: 'razorpay',
        RAZORPAY_KEY_ID: 'rzp_test_x',
        RAZORPAY_SECRET: new Secret('k'),
        RAZORPAY_WEBHOOK_SECRET: SECRET,
      }),
    ).toBe(SECRET);
    expect(webhookSecretFor({ BILLING_PROVIDER: 'mock' })).toBe(MOCK_WEBHOOK_SECRET);
    expect(String(MOCK_WEBHOOK_SECRET)).toBe('[REDACTED]');
  });
});

describe('isWithinReplayWindow', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  const at = (offsetMs: number) => (now.getTime() + offsetMs) / 1000;

  it('accepts events up to 72 h old and 5 min in the future', () => {
    expect(isWithinReplayWindow(at(0), now)).toBe(true);
    expect(isWithinReplayWindow(at(-72 * 3600_000), now)).toBe(true);
    expect(isWithinReplayWindow(at(5 * 60_000), now)).toBe(true);
  });

  it('rejects older, too-future and non-numeric timestamps', () => {
    expect(isWithinReplayWindow(at(-72 * 3600_000 - 1000), now)).toBe(false);
    expect(isWithinReplayWindow(at(5 * 60_000 + 1000), now)).toBe(false);
    expect(isWithinReplayWindow('1767225600', now)).toBe(false);
    expect(isWithinReplayWindow(undefined, now)).toBe(false);
    expect(isWithinReplayWindow(Number.NaN, now)).toBe(false);
  });

  it('honours a custom window', () => {
    expect(isWithinReplayWindow(at(-120_000), now, { maxAgeMs: 60_000 })).toBe(false);
  });
});

describe('mock deliveries', () => {
  it('are signed with the mock secret over the exact raw body', async () => {
    const provider = createMockBillingProvider();
    const customer = await provider.createCustomer({ email: 'a@example.in' });
    const sub = await provider.createSubscription({
      customerId: customer.id,
      planId: 'advocate-monthly-1',
      quantity: 1,
    });
    await provider.authorizeMandate(sub.id);
    const [delivery] = provider.deliveries();
    if (!delivery) throw new Error('no delivery');
    const signed = signMockDelivery(delivery);
    expect(signed.eventId).toBe(delivery.eventId);
    expect(JSON.parse(signed.rawBody)).toEqual(delivery.body);
    expect(verifyRazorpaySignature(signed.rawBody, signed.signature, MOCK_WEBHOOK_SECRET)).toBe(
      true,
    );
  });
});

describe('minimiseWebhookEvent', () => {
  it('drops contact data and notes but keeps what the state machine reads', async () => {
    const provider = createMockBillingProvider();
    const customer = await provider.createCustomer({ email: 'pay@example.in', contact: '9999' });
    const sub = await provider.createSubscription({
      customerId: customer.id,
      planId: 'advocate-monthly-1',
      quantity: 2,
      notes: { workspace_id: 'spoofed' },
    });
    await provider.authorizeMandate(sub.id);
    const body = await provider.simulate(sub.id, 'payment.failed');
    const minimised = minimiseWebhookEvent(body);
    const json = JSON.stringify(minimised);
    expect(json).not.toContain('pay@example.in');
    expect(json).not.toContain('9999');
    expect(json).not.toContain('spoofed');
    expect(minimised.event).toBe('payment.failed');
    expect(minimised.created_at).toBe(body.created_at);
    expect(minimised.payload.subscription?.entity.id).toBe(sub.id);
    expect(minimised.payload.subscription?.entity.quantity).toBe(2);
    expect(minimised.payload.payment?.entity).toEqual({
      id: body.payload.payment?.entity.id,
      entity: 'payment',
      status: 'failed',
      amount: body.payload.payment?.entity.amount,
      error_code: 'BAD_REQUEST_ERROR',
    });
  });
});
