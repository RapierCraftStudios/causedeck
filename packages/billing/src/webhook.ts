// Razorpay webhook helpers (#28 part 5, #204). Pure and server-only (node:crypto), so it is the
// `@causedeck/billing/webhook` subpath and not part of the web-safe barrel.
//
// Razorpay signs the raw request body with the endpoint's secret: `X-Razorpay-Signature` is the
// hex HMAC-SHA256. Verification compares in constant time and never throws. Dev and CI run the
// mock provider, which signs its deliveries with `MOCK_WEBHOOK_SECRET` (the env schema rejects
// the mock in production unless `ALLOW_MOCK_PROVIDERS=true`).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { Secret } from '@causedeck/config/env';

import type { BillingProviderEnv } from './provider/index';
import type { RazorpayPaymentEntity, RazorpayWebhookEvent } from './provider/types';

export const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';
export const RAZORPAY_EVENT_ID_HEADER = 'x-razorpay-event-id';

/** Test-only signing secret for the mock provider's deliveries. Never a live value. */
export const MOCK_WEBHOOK_SECRET = new Secret('mock-razorpay-webhook-secret-not-for-production');

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/** The hex HMAC-SHA256 of `rawBody`: what Razorpay sends as `X-Razorpay-Signature`. */
export function signRazorpayWebhook(rawBody: string, secret: Secret): string {
  return createHmac('sha256', secret.reveal()).update(rawBody, 'utf8').digest('hex');
}

/** Hex SHA-256 of the raw body, stored as `billing_event.payload_hash`. */
export function hashWebhookBody(rawBody: string): string {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

/** `true` when `signature` is the HMAC of `rawBody`; constant-time, false on any malformed input. */
export function verifyRazorpaySignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: Secret,
): boolean {
  if (typeof signature !== 'string' || !HEX_SHA256.test(signature)) return false;
  const expected = Buffer.from(signRazorpayWebhook(rawBody, secret), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/** The webhook signing secret for the selected provider. */
export function webhookSecretFor(env: BillingProviderEnv): Secret {
  return env.BILLING_PROVIDER === 'razorpay' ? env.RAZORPAY_WEBHOOK_SECRET : MOCK_WEBHOOK_SECRET;
}

export interface ReplayWindow {
  /** Oldest accepted event age. Razorpay retries failed deliveries for about 24 h. */
  maxAgeMs?: number;
  /** Clock skew tolerated for events stamped in the future. */
  maxSkewMs?: number;
}

export const DEFAULT_REPLAY_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const DEFAULT_REPLAY_MAX_SKEW_MS = 5 * 60 * 1000;

/** Whether an event created at `createdAtUnix` (seconds) is inside the replay window at `now`. */
export function isWithinReplayWindow(
  createdAtUnix: unknown,
  now: Date,
  {
    maxAgeMs = DEFAULT_REPLAY_MAX_AGE_MS,
    maxSkewMs = DEFAULT_REPLAY_MAX_SKEW_MS,
  }: ReplayWindow = {},
): boolean {
  if (typeof createdAtUnix !== 'number' || !Number.isFinite(createdAtUnix)) return false;
  const age = now.getTime() - createdAtUnix * 1000;
  return age <= maxAgeMs && age >= -maxSkewMs;
}

/**
 * The stored form of a webhook event: what `applyProviderEvent` reads, without contact data. The
 * subscription keeps every field except `notes`; the payment keeps its id, status, amount and
 * error code only (no email, contact or description).
 */
export function minimiseWebhookEvent(body: RazorpayWebhookEvent): RazorpayWebhookEvent {
  const subscription = body.payload.subscription?.entity;
  const payment = body.payload.payment?.entity;
  const payload: RazorpayWebhookEvent['payload'] = {};
  if (subscription) payload.subscription = { entity: { ...subscription, notes: [] } };
  if (payment) {
    payload.payment = {
      entity: {
        id: payment.id,
        entity: payment.entity,
        status: payment.status,
        amount: payment.amount,
        error_code: payment.error_code,
      } as RazorpayPaymentEntity, // a deliberate subset: the job never reads the rest
    };
  }
  return {
    entity: body.entity,
    account_id: body.account_id,
    event: body.event,
    contains: body.contains,
    payload,
    created_at: body.created_at,
  };
}
