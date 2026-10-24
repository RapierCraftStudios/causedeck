// Auth SMS delivery (#503): the phone sign-in OTP goes through the `SmsSender` that SMS_PROVIDER
// selects, mirroring `mailer.ts`: the console in dev/CI, MSG91 with a DLT-registered template
// (India) in production. Callers never see the provider; they hand over a phone number and a code.
import type { Secret, ServerEnv } from '@causedeck/config/env';

import { consoleLogger, type AuthLogger } from './mailer';

/** One OTP text. `phoneNumber` is E.164 (`+919876543210`). */
export interface AuthSms {
  phoneNumber: string;
  code: string;
  expiresInMinutes: number;
}

export interface SmsSender {
  send(message: AuthSms): Promise<void>;
}

/** The env keys the SMS sender reads. */
export type SmsEnv = Pick<ServerEnv, 'NODE_ENV' | 'SMS_PROVIDER'> & {
  SMS_AUTH_KEY?: Secret | undefined;
  SMS_SENDER_ID?: string | undefined;
  SMS_DLT_ENTITY_ID?: string | undefined;
  SMS_OTP_TEMPLATE_ID?: string | undefined;
};

/** Last four digits only, so logs can correlate a send without holding the number. */
export function maskPhone(phoneNumber: string): string {
  return `***${phoneNumber.slice(-4)}`;
}

/**
 * Logs the message instead of sending it. The code is written only outside production: a console
 * sender that reaches production logs nothing sensitive (and the person simply gets no SMS).
 */
export function consoleSmsSender(
  logger: AuthLogger = consoleLogger,
  { includeCode }: { includeCode: boolean },
): SmsSender {
  return {
    send({ phoneNumber, code, expiresInMinutes }) {
      logger.info(
        {
          to: includeCode ? phoneNumber : maskPhone(phoneNumber),
          ...(includeCode ? { code } : {}),
          expiresInMinutes,
        },
        'auth sms (console)',
      );
      return Promise.resolve();
    },
  };
}

export interface Msg91Config {
  authKey: string;
  senderId: string;
  dltEntityId: string;
  templateId: string;
}

const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow';

/**
 * MSG91 Flow API with the DLT-registered OTP template. India's DLT rules require the principal
 * entity id and the registered template id on every transactional text; the template carries one
 * variable, `##otp##`.
 */
export function msg91SmsSender(config: Msg91Config, fetchImpl: typeof fetch = fetch): SmsSender {
  return {
    async send({ phoneNumber, code }) {
      const response = await fetchImpl(MSG91_FLOW_URL, {
        method: 'POST',
        headers: { authkey: config.authKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          template_id: config.templateId,
          sender: config.senderId,
          DLT_TE_ID: config.templateId,
          PE_ID: config.dltEntityId,
          short_url: '0',
          recipients: [{ mobiles: phoneNumber.replace(/^\+/, ''), otp: code }],
        }),
      });
      if (!response.ok) throw new Error(`msg91 responded ${String(response.status)}`);
    },
  };
}

/** Pick the sender from SMS_PROVIDER. */
export function createSmsSender(
  env: SmsEnv,
  logger: AuthLogger = consoleLogger,
  fetchImpl: typeof fetch = fetch,
): SmsSender {
  if (env.SMS_PROVIDER === 'msg91') {
    const { SMS_AUTH_KEY, SMS_SENDER_ID, SMS_DLT_ENTITY_ID, SMS_OTP_TEMPLATE_ID } = env;
    if (SMS_AUTH_KEY && SMS_SENDER_ID && SMS_DLT_ENTITY_ID && SMS_OTP_TEMPLATE_ID) {
      return msg91SmsSender(
        {
          authKey: SMS_AUTH_KEY.reveal(),
          senderId: SMS_SENDER_ID,
          dltEntityId: SMS_DLT_ENTITY_ID,
          templateId: SMS_OTP_TEMPLATE_ID,
        },
        fetchImpl,
      );
    }
    logger.warn({}, 'SMS_PROVIDER=msg91 without credentials; falling back to the console sender');
  }
  return consoleSmsSender(logger, { includeCode: env.NODE_ENV !== 'production' });
}
