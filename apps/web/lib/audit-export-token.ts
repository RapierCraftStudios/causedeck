// Short-lived signed download tokens for the audit export (#229). `POST /api/audit/export` checks
// `audit.read` and hands out a token; `GET /api/audit/export?token=` streams the file. The token is
// `base64url(JSON) "." base64url(HMAC-SHA256)`, keyed by a key derived from the Better Auth secret,
// and expires after `EXPORT_TOKEN_TTL_MS`. Node-only (node:crypto); route handlers only.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

/** How long a download link stays valid. */
export const EXPORT_TOKEN_TTL_MS = 60_000;

const payloadSchema = z
  .object({
    /** Workspace id. */
    w: z.uuid(),
    /** User id the link was issued to. */
    u: z.string().min(1),
    /** ISO 8601, inclusive. */
    from: z.iso.datetime({ offset: true }),
    /** ISO 8601, exclusive. */
    to: z.iso.datetime({ offset: true }),
    format: z.enum(['csv', 'jsonl']),
    bom: z.boolean(),
    /** Expiry, epoch milliseconds. */
    exp: z.number().int().positive(),
  })
  .strict();

export type ExportTokenPayload = z.infer<typeof payloadSchema>;

function key(secret: string): Buffer {
  return createHmac('sha256', secret).update('causedeck:audit-export:v1').digest();
}

function mac(body: string, secret: string): Buffer {
  return createHmac('sha256', key(secret)).update(body).digest();
}

/** Sign `payload` (callers set `exp`, normally `now + EXPORT_TOKEN_TTL_MS`). */
export function signExportToken(payload: ExportTokenPayload, secret: string, now: number): string {
  if (payload.exp <= now) throw new Error('export token already expired');
  const body = Buffer.from(JSON.stringify(payloadSchema.parse(payload)), 'utf8').toString(
    'base64url',
  );
  return `${body}.${mac(body, secret).toString('base64url')}`;
}

/** The payload of a well-formed, correctly signed, unexpired token; otherwise `null`. */
export function verifyExportToken(
  token: string,
  secret: string,
  now: number,
): ExportTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  const given = Buffer.from(signature, 'base64url');
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success || parsed.data.exp <= now) return null;
  return parsed.data;
}
