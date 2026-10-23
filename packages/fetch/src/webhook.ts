// The one outbound, non-source request the platform makes: a JSON POST to a Slack incoming
// webhook for data-ops alerts (#515). It lives here because only this package may call `fetch` on
// an external host (#479). It is not a source read, so it skips the registry, but it fails closed:
// only an https URL on an allow-listed Slack host is ever called, and the payload is text the
// caller already made content-free.
import { FetchDenied } from './types.ts';

/** Hosts a webhook may point at. */
export const WEBHOOK_HOSTS: readonly string[] = ['hooks.slack.com'];

export interface WebhookPayload {
  text: string;
}

/** POST `payload` to a Slack incoming webhook; throws `FetchDenied` for any other URL. */
export async function postWebhook(
  url: string,
  payload: WebhookPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new FetchDenied('invalid_url', 'webhook');
  }
  if (target.protocol !== 'https:' || !WEBHOOK_HOSTS.includes(target.hostname)) {
    throw new FetchDenied('url_outside_source', 'webhook');
  }
  const response = await fetchImpl(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Webhook responded ${String(response.status)}`);
}
