// The inbound email seam (#54 part 3, #530). A provider turns what the transport delivered (an SNS
// notification in production, a shared-secret JSON post in dev and CI) into notifications, and
// reads the raw message back by reference. It never parses MIME and imports no mail transport:
// `email/mime.ts` and the parser registry (#528) read what `fetchRaw` returns.
import { timingSafeEqual } from 'node:crypto';

/** One received message: who it was sent to, its id, and where the raw bytes are. */
export interface InboundNotification {
  /** The `Message-ID` header (or the provider's id); the dedupe key within a workspace. */
  messageId: string;
  /** Lower-case recipient addresses (the envelope recipients, not the `To` header). */
  recipients: string[];
  /** An opaque reference `fetchRaw` understands (`s3://bucket/key`, a file name, a Mailpit id). */
  rawRef: string;
}

export interface InboundRequest {
  /** Header names lower-case. */
  headers: Readonly<Record<string, string | undefined>>;
  /** The raw request body, unparsed. */
  body: string;
}

export type InboundVerification =
  { ok: true; notifications: InboundNotification[] } | { ok: false; reason: string };

export interface InboundEmailProvider {
  id: 'ses' | 'file' | 'mailpit';
  /** Authenticates the request and extracts its notifications; never throws for bad input. */
  verify(request: InboundRequest): Promise<InboundVerification>;
  fetchRaw(rawRef: string): Promise<Uint8Array>;
  /** Deletes the raw message at the source (retention); absent when the source is read-only. */
  discardRaw?(rawRef: string): Promise<void>;
}

/** The dev and CI providers authenticate with this header instead of an SNS signature. */
export const INBOUND_SECRET_HEADER = 'x-causedeck-inbound-secret';

const MESSAGE_ID = /^[\x21-\x7e]{1,998}$/;
const ADDRESS = /^[^\s@<>]{1,64}@[^\s@<>]{1,255}$/;

export function verifySharedSecret(header: string | undefined, secret: string): boolean {
  if (header === undefined || secret === '') return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The body of a dev post: `{ messageId, recipients, ref }`. `null` when it is anything else. */
export function parseDevNotification(body: string): InboundNotification | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { messageId, recipients, ref } = value as Record<string, unknown>;
  if (typeof messageId !== 'string' || !MESSAGE_ID.test(messageId)) return null;
  if (typeof ref !== 'string' || ref === '' || ref.length > 1024) return null;
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 50) return null;
  const addresses = recipients.map((r) => (typeof r === 'string' ? r.trim().toLowerCase() : ''));
  if (!addresses.every((a) => ADDRESS.test(a))) return null;
  return { messageId, recipients: addresses, rawRef: ref };
}

/** Verifies the shared secret and the dev body; the file and Mailpit providers share it. */
export function verifyDevRequest(request: InboundRequest, secret: string): InboundVerification {
  if (!verifySharedSecret(request.headers[INBOUND_SECRET_HEADER], secret)) {
    return { ok: false, reason: 'bad_secret' };
  }
  const notification = parseDevNotification(request.body);
  return notification === null
    ? { ok: false, reason: 'bad_body' }
    : { ok: true, notifications: [notification] };
}
