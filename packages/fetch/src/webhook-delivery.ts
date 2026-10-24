// Customer webhook delivery (#626, #487 part 3): a signed JSON POST to a URL a workspace registered.
// It lives here because only this package may call `fetch` on an external host (#479). It is not a
// source read, so it skips the registry, but it fails closed: only an https URL whose host resolves
// to public addresses is called, redirects are never followed (a 3xx is returned as a status), the
// call times out, and the response body is never read, so a hostile receiver cannot make us store or
// log anything. The address check resolves the host before the call; the platform's egress rules
// are the second layer against a host that re-resolves between the check and the connection.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type WebhookDeliveryErrorReason =
  | 'invalid_url'
  | 'blocked_address'
  | 'unresolvable'
  | 'timeout'
  | 'network';

/** The delivery was refused or never got an HTTP response; `status` of a response is a result, not an error. */
export class WebhookDeliveryError extends Error {
  readonly code = 'WEBHOOK_DELIVERY_ERROR' as const;
  constructor(readonly reason: WebhookDeliveryErrorReason) {
    super(`Webhook delivery failed: ${reason}`);
    this.name = 'WebhookDeliveryError';
  }
}

export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

/** Whether `address` (an IPv4 or IPv6 literal) is loopback, private, link-local or otherwise not public. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1] !== undefined) return isBlockedAddress(mapped[1]);
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith('ff') ||
      lower.startsWith('::ffff:')
    );
  }
  return true;
}

export interface WebhookRequest {
  /** The serialized JSON body, exactly as signed. */
  body: string;
  /** Signature and id headers; `content-type` is always `application/json`. */
  headers: Record<string, string>;
}

export interface DeliverWebhookOptions {
  fetchImpl?: typeof fetch;
  /** Resolves a host to its addresses; defaults to the system resolver. */
  resolve?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
}

const systemResolve = async (host: string): Promise<string[]> =>
  (await lookup(host, { all: true })).map((entry) => entry.address);

/** POST `request` to a customer webhook URL; returns the HTTP status of the response. */
export async function deliverWebhook(
  url: string,
  request: WebhookRequest,
  options: DeliverWebhookOptions = {},
): Promise<{ status: number }> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new WebhookDeliveryError('invalid_url');
  }
  if (target.protocol !== 'https:' || target.username !== '' || target.password !== '') {
    throw new WebhookDeliveryError('invalid_url');
  }
  const host = target.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host) === 0) {
    try {
      addresses = await (options.resolve ?? systemResolve)(host);
    } catch {
      throw new WebhookDeliveryError('unresolvable');
    }
  } else {
    addresses = [host];
  }
  if (addresses.length === 0) throw new WebhookDeliveryError('unresolvable');
  if (addresses.some(isBlockedAddress)) throw new WebhookDeliveryError('blocked_address');

  const timeoutMs = options.timeoutMs ?? WEBHOOK_DELIVERY_TIMEOUT_MS;
  try {
    const response = await (options.fetchImpl ?? fetch)(target, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...request.headers, 'content-type': 'application/json' },
      body: request.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return { status: response.status };
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new WebhookDeliveryError('timeout');
    }
    throw new WebhookDeliveryError('network');
  }
}
