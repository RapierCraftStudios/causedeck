// Auth email delivery. `consoleMailer` is the dev/CI default (spike §9); `smtpMailer` sends to
// Mailpit locally when EMAIL_PROVIDER=smtp. The real templated transport (SES) arrives in #23.
import type { Secret, ServerEnv } from '@causedeck/config/env';
import { createTransport } from 'nodemailer';

import type { AuthLocale } from './messages';

/**
 * A magic-link or workspace invitation (#178) email. Subject and body are i18n keys, resolved by
 * the transport.
 */
export interface AuthEmail {
  to: string;
  template: 'auth.magicLink' | 'workspace.invitation';
  subjectKey: string;
  bodyKey: string;
  url: string;
  locale: AuthLocale;
  expiresInMinutes: number;
}

export interface Mailer {
  send(message: AuthEmail): Promise<void>;
}

/** The subset of a pino logger the auth package writes to. */
export interface AuthLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Writes to stdout/stderr; used when no logger is injected. */
export const consoleLogger: AuthLogger = {
  debug: (obj, msg) => {
    console.debug(msg ?? '', obj);
  },
  info: (obj, msg) => {
    console.info(msg ?? '', obj);
  },
  warn: (obj, msg) => {
    console.warn(msg ?? '', obj);
  },
  error: (obj, msg) => {
    console.error(msg ?? '', obj);
  },
};

/**
 * Logs the email instead of sending it. The link is printed on its own line so terminals make it
 * clickable.
 */
export function consoleMailer(logger: AuthLogger = consoleLogger): Mailer {
  return {
    send(message) {
      logger.info(
        {
          to: message.to,
          template: message.template,
          subjectKey: message.subjectKey,
          bodyKey: message.bodyKey,
          locale: message.locale,
          expiresInMinutes: message.expiresInMinutes,
        },
        `auth email (console mailer)\n${message.url}\n`,
      );
      return Promise.resolve();
    },
  };
}

/** Plain-text SMTP delivery (Mailpit in dev). The URL is revealed only to build the transport. */
export function smtpMailer(smtpUrl: Secret, from = 'CauseDeck <no-reply@causedeck.local>'): Mailer {
  const transport = createTransport(smtpUrl.reveal());
  return {
    async send(message) {
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subjectKey,
        text: `${message.bodyKey}\n\n${message.url}\n`,
      });
    },
  };
}

type MailerEnv = Pick<ServerEnv, 'EMAIL_PROVIDER'> & { SMTP_URL?: Secret };

/** Pick the transport for EMAIL_PROVIDER: smtp sends, everything else logs (SES lands in #23). */
export function createMailer(env: MailerEnv, logger: AuthLogger = consoleLogger): Mailer {
  if (env.EMAIL_PROVIDER === 'smtp' && env.SMTP_URL !== undefined) return smtpMailer(env.SMTP_URL);
  if (env.EMAIL_PROVIDER === 'ses') {
    logger.warn({ provider: 'ses' }, 'SES transport arrives in #23; using the console mailer');
  }
  return consoleMailer(logger);
}
