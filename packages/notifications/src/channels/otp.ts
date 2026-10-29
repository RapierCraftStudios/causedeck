// WhatsApp link code delivery (#711, completes #678/#681). The code for linking a number goes out
// as a provider-approved authentication template through the same provider abstraction as the other
// WhatsApp messages. Provider selection mirrors email and SMS: the real Cloud API sender only when
// its env is present (provider credentials AND the approved template name, which is a human step,
// #708/#488); otherwise a console sender outside production and a refusing sender in production.
// The code is a template parameter only. It is never logged, by any sender here; logs carry the
// last four digits of the number, the template name and status codes.
import {
  WHATSAPP_E164,
  whatsappConfig,
  WhatsAppDeliveryError,
  type WhatsAppEnv,
  type WhatsAppFetch,
  type WhatsAppLogger,
  type WhatsAppTarget,
} from './whatsapp.ts';

/**
 * The authentication template to submit to the provider. Meta fixes the body wording of
 * authentication templates ("<code> is your verification code. For your security, do not share
 * it.") and adds the copy-code button; both take the code as parameter 1.
 */
export const WHATSAPP_OTP_TEMPLATE = {
  /** Suggested registered name; the deployed name is `WHATSAPP_OTP_TEMPLATE_NAME`. */
  defaultName: 'causedeck_link_otp',
  category: 'AUTHENTICATION',
  language: 'en',
  addSecurityRecommendation: true,
  copyCodeButton: true,
} as const;

export interface WhatsAppOtpEnv extends WhatsAppEnv {
  WHATSAPP_OTP_TEMPLATE_NAME?: string | undefined;
  NODE_ENV?: string | undefined;
}

export interface WhatsAppOtpMessage {
  code: string;
  expiresInMinutes: number;
}

export interface WhatsAppOtpSender {
  sendOtp(
    message: WhatsAppOtpMessage,
    target: WhatsAppTarget,
  ): Promise<{ messageId: string | null }>;
}

/** Last four digits only, so logs correlate a send without holding the number. */
const maskNumber = (e164: string): string => `***${e164.slice(-4)}`;

/** The Cloud API body for one authentication template message carrying `code`. */
export function buildOtpBody(templateName: string, message: WhatsAppOtpMessage, e164: string) {
  return {
    messaging_product: 'whatsapp',
    to: e164.slice(1),
    type: 'template',
    template: {
      name: templateName,
      language: { code: WHATSAPP_OTP_TEMPLATE.language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: message.code }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: message.code }],
        },
      ],
    },
  };
}

/** Logs that a code would be sent, never the code or the full number. */
export function consoleWhatsAppOtpSender(log?: WhatsAppLogger): WhatsAppOtpSender {
  return {
    sendOtp(message, target) {
      log?.info(
        { to: maskNumber(target.e164), expiresInMinutes: message.expiresInMinutes },
        'whatsapp otp (console, not delivered)',
      );
      return Promise.resolve({ messageId: null });
    },
  };
}

/** Keeps what it was asked to send, for tests. The only place a code is held, in memory. */
export function mockWhatsAppOtpSender(): WhatsAppOtpSender & {
  readonly outbox: { e164: string; code: string; expiresInMinutes: number }[];
} {
  const outbox: { e164: string; code: string; expiresInMinutes: number }[] = [];
  return {
    outbox,
    sendOtp(message, target) {
      outbox.push({ e164: target.e164, ...message });
      return Promise.resolve({ messageId: `mock-${String(outbox.length)}` });
    },
  };
}

/** The real sender for an approved template. */
export function cloudWhatsAppOtpSender(
  env: WhatsAppEnv,
  templateName: string,
  log?: WhatsAppLogger,
  request: WhatsAppFetch = fetch,
): WhatsAppOtpSender | undefined {
  const config = whatsappConfig(env);
  if (config === null) return undefined;
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  return {
    async sendOtp(message, target) {
      if (!WHATSAPP_E164.test(target.e164)) throw new WhatsAppDeliveryError(undefined, true);
      let response;
      try {
        response = await request(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.accessToken.reveal()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(buildOtpBody(templateName, message, target.e164)),
        });
      } catch {
        log?.warn({ template: templateName }, 'whatsapp otp request failed');
        throw new WhatsAppDeliveryError(undefined, false);
      }
      if (!response.ok) {
        const permanent =
          response.status >= 400 && response.status < 500 && response.status !== 429;
        log?.warn({ template: templateName, status: response.status }, 'whatsapp otp rejected');
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
 * Pick the sender: the real one only with provider env and an approved template name; else the
 * console sender outside production; in production without config, a sender that refuses, so the
 * member sees a failure instead of waiting for a code that will never arrive.
 */
export function createWhatsAppOtpSender({
  env,
  log,
  fetch: request = fetch,
}: {
  env: WhatsAppOtpEnv;
  log?: WhatsAppLogger | undefined;
  fetch?: WhatsAppFetch | undefined;
}): WhatsAppOtpSender {
  const templateName = env.WHATSAPP_OTP_TEMPLATE_NAME;
  if (templateName !== undefined) {
    const real = cloudWhatsAppOtpSender(env, templateName, log, request);
    if (real !== undefined) return real;
  }
  if (env.NODE_ENV === 'production') {
    log?.warn({}, 'whatsapp otp not configured; refusing to send');
    return {
      sendOtp: () => Promise.reject(new WhatsAppDeliveryError(undefined, true)),
    };
  }
  return consoleWhatsAppOtpSender(log);
}
