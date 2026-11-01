// WhatsApp Business outbound channel (#679, part 2 of #502, D-029). `notification.deliver` and the
// end-of-day digest call `WhatsAppSender.send` with a target that `@causedeck/core/whatsapp-link`
// resolved: the verified number of the member who owns the notification, who consented and chose
// the category. The sender never reads a number from a notification or any other input, and it
// re-checks the E.164 shape before the request. Only approved templates are sent, with a link and
// counts as parameters, never titles, bodies or party names. Without the provider env the sender
// does not exist (`createWhatsAppSender` returns `undefined`) and delivery is recorded as skipped.
// Logs carry ids, template names and status codes only, never the number or message.
import type { Secret } from '@causedeck/config/env';

export interface WhatsAppEnv {
  WHATSAPP_PHONE_NUMBER_ID?: string | undefined;
  WHATSAPP_ACCESS_TOKEN?: Secret | undefined;
  WHATSAPP_API_VERSION?: string | undefined;
}

/** Categories with an approved template, and the template name registered with the provider. */
export const WHATSAPP_TEMPLATES = {
  'court.board': 'causedeck_court_board',
  'status.order': 'causedeck_status_order',
  'digest.end_of_day': 'causedeck_end_of_day',
  // Onboarding nudge (#601): a link only. The provider has not approved it yet (owner action), so
  // the job runs on `createMockWhatsAppSender` until the real sender is configured.
  'onboarding.nudge': 'causedeck_onboarding_nudge',
} as const;
export type WhatsAppCategory = keyof typeof WHATSAPP_TEMPLATES;

export const WHATSAPP_CATEGORIES = Object.keys(WHATSAPP_TEMPLATES) as WhatsAppCategory[];

/** Does `category` have an approved template? */
export function hasWhatsAppTemplate(category: string): category is WhatsAppCategory {
  return Object.hasOwn(WHATSAPP_TEMPLATES, category);
}

/** The destination, resolved by the caller from the owner's verified link. */
export interface WhatsAppTarget {
  e164: string;
}

export interface WhatsAppMessage {
  category: WhatsAppCategory;
  /** Template body parameters, in order: a link, or counts and a link. No free text. */
  params: readonly string[];
  /** Template language code, default `en`. */
  language?: string;
}

export interface WhatsAppSender {
  send(message: WhatsAppMessage, target: WhatsAppTarget): Promise<{ messageId: string | null }>;
}

export interface WhatsAppLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

/** The provider rejected or could not take the message. `permanent` means do not retry. */
export class WhatsAppDeliveryError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly permanent: boolean,
  ) {
    super(`whatsapp send failed (${status === undefined ? 'network' : String(status)})`);
    this.name = 'WhatsAppDeliveryError';
  }
}

export type WhatsAppFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface WhatsAppSenderOptions {
  env: WhatsAppEnv;
  log?: WhatsAppLogger | undefined;
  fetch?: WhatsAppFetch | undefined;
}

export const WHATSAPP_E164 = /^\+[1-9][0-9]{7,14}$/;
const DEFAULT_API_VERSION = 'v21.0';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: Secret;
  apiVersion: string;
}

/** The provider config, or `null` when it is absent (WhatsApp disabled). */
export function whatsappConfig(env: WhatsAppEnv): WhatsAppConfig | null {
  if (env.WHATSAPP_PHONE_NUMBER_ID === undefined || env.WHATSAPP_ACCESS_TOKEN === undefined) {
    return null;
  }
  return {
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    apiVersion: env.WHATSAPP_API_VERSION ?? DEFAULT_API_VERSION,
  };
}

/** The Cloud API request body for one template message. */
export function buildTemplateBody(message: WhatsAppMessage, target: WhatsAppTarget) {
  return {
    messaging_product: 'whatsapp',
    to: target.e164.slice(1),
    type: 'template',
    template: {
      name: WHATSAPP_TEMPLATES[message.category],
      language: { code: message.language ?? 'en' },
      components: [
        {
          type: 'body',
          parameters: message.params.map((text) => ({ type: 'text', text })),
        },
      ],
    },
  };
}

/** The env-configured sender, or `undefined` when the provider env is absent (WhatsApp disabled). */
export function createWhatsAppSender({
  env,
  log,
  fetch: request = fetch,
}: WhatsAppSenderOptions): WhatsAppSender | undefined {
  const config = whatsappConfig(env);
  if (config === null) return undefined;
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  return {
    async send(message, target) {
      if (!WHATSAPP_E164.test(target.e164)) throw new WhatsAppDeliveryError(undefined, true);
      let response;
      try {
        response = await request(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.accessToken.reveal()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(buildTemplateBody(message, target)),
        });
      } catch {
        log?.warn({ template: message.category }, 'whatsapp request failed');
        throw new WhatsAppDeliveryError(undefined, false);
      }
      if (!response.ok) {
        // 4xx other than rate limiting will not succeed on a retry; 429 and 5xx will.
        const permanent =
          response.status >= 400 && response.status < 500 && response.status !== 429;
        log?.warn(
          { template: message.category, status: response.status },
          'whatsapp send rejected',
        );
        throw new WhatsAppDeliveryError(response.status, permanent);
      }
      const body = (await response.json().catch(() => null)) as {
        messages?: { id?: unknown }[];
      } | null;
      const id = body?.messages?.[0]?.id;
      return { messageId: typeof id === 'string' ? id : null };
    },
  };
}

/**
 * A sender for staging and for a deployment without provider credentials: it sends nothing and
 * records the template name only, never the number or the parameters. Same shape as the real one.
 */
export function createMockWhatsAppSender({
  log,
}: {
  log?: WhatsAppLogger | undefined;
}): WhatsAppSender {
  return {
    send(message, target) {
      if (!WHATSAPP_E164.test(target.e164)) {
        return Promise.reject(new WhatsAppDeliveryError(undefined, true));
      }
      log?.info({ template: WHATSAPP_TEMPLATES[message.category] }, 'whatsapp mock send');
      return Promise.resolve({ messageId: null });
    },
  };
}
