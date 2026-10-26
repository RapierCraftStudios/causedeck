// Email transports (#195, #23; spike §1). One `EmailTransport` interface with three
// implementations, picked from `EMAIL_PROVIDER` at startup, so the real transport is an env change
// and never a code change:
// - `console` (dev/CI default) logs the message, including the plain-text body;
// - `smtp` sends through nodemailer (Mailpit in dev);
// - `ses` sends through Amazon SES v2 in an India region (ap-south-1).
// Missing credentials never break boot: the selector falls back to the console with a warning.
import { OVERRIDE_ACK, type Secret } from '@causedeck/config/env';

import { consoleTransport } from './console-transport.ts';
import { sesTransport } from './ses-transport.ts';
import { smtpTransport } from './smtp-transport.ts';

/** A fully rendered email. Subject, HTML and text come from `renderEmail`. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string> | undefined;
  /** Log context (template name, i18n keys). Written by the console transport, never sent. */
  tags?: Record<string, string | number> | undefined;
}

export interface EmailTransport {
  readonly provider: 'console' | 'smtp' | 'ses';
  send(message: EmailMessage): Promise<{ messageId?: string | undefined }>;
}

/** The subset of a pino logger the email transports write to. */
export interface EmailLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** The sender for every transport until a verified SES domain is configured (#110). */
export const DEFAULT_FROM = 'CauseDeck <no-reply@causedeck.local>';

export interface EmailTransportEnv {
  EMAIL_PROVIDER: 'console' | 'ses' | 'smtp';
  SES_REGION?: string | undefined;
  SES_ACCESS_KEY_ID?: string | undefined;
  SES_SECRET_ACCESS_KEY?: Secret | undefined;
  SMTP_URL?: Secret | undefined;
  AWS_REGION_OVERRIDE_ACK?: string | undefined;
}

/**
 * Pick the transport for `EMAIL_PROVIDER`. A selected provider without its credentials falls back
 * to the console (logged once here); a non-India SES region throws (see `sesTransport`).
 */
export function createEmailTransport(
  env: EmailTransportEnv,
  logger: EmailLogger,
  from: string = DEFAULT_FROM,
): EmailTransport {
  if (env.EMAIL_PROVIDER === 'smtp') {
    if (env.SMTP_URL !== undefined) return smtpTransport(env.SMTP_URL, from);
    logger.warn({ provider: 'smtp' }, 'SMTP_URL is not set; using the console email transport');
  }
  if (env.EMAIL_PROVIDER === 'ses') {
    const { SES_REGION, SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY } = env;
    if (SES_REGION && SES_ACCESS_KEY_ID && SES_SECRET_ACCESS_KEY !== undefined) {
      return sesTransport({
        region: SES_REGION,
        accessKeyId: SES_ACCESS_KEY_ID,
        secretAccessKey: SES_SECRET_ACCESS_KEY,
        from,
        allowNonIndiaRegion: env.AWS_REGION_OVERRIDE_ACK === OVERRIDE_ACK,
      });
    }
    logger.warn(
      { provider: 'ses' },
      'SES credentials are not set; using the console email transport',
    );
  }
  return consoleTransport(logger);
}
