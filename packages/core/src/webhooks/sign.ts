import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Headers on every delivery. The signature covers `<timestamp>.<body>`; the id is stable across retries. */
export const WEBHOOK_HEADERS = {
  event: 'x-causedeck-event',
  delivery: 'x-causedeck-delivery',
  timestamp: 'x-causedeck-timestamp',
  signature: 'x-causedeck-signature',
} as const;

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/** `v1=<hex>`: HMAC-SHA256 of `<unix seconds>.<body>` under the endpoint secret. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret)
    .update(`${String(timestamp)}.${body}`)
    .digest('hex')}`;
}

/** Whether `signature` is the signature of this timestamp and body (constant time); for receivers and tests. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
