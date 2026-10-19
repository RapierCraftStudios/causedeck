// Auth email delivery (#152, #178), converged onto the notifications email layer (#195): each auth
// email is an explicit React Email template call (`magic-link`, `invitation`) rendered in the
// recipient's locale and sent through the `EmailTransport` that EMAIL_PROVIDER selects: the console
// in dev/CI, SMTP (Mailpit) locally, Amazon SES (ap-south-1) in production.
import type { Secret, ServerEnv } from '@causedeck/config/env';
import {
  consoleTransport,
  createEmailTransport,
  DEFAULT_FROM,
  preferencesUrl,
  renderEmail,
  smtpTransport,
  type EmailTransport,
  type RenderedEmail,
} from '@causedeck/notifications/email';

import type { AuthLocale } from './messages';

/**
 * A magic-link or workspace invitation (#178) email. `template` picks the React Email template that
 * renders it; the subject and body keys travel along as log context.
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

/** Render the explicit template for an auth email. */
export function renderAuthEmail(message: AuthEmail): Promise<RenderedEmail> {
  if (message.template === 'auth.magicLink') {
    return renderEmail(
      'magic-link',
      { url: message.url, expiresInMinutes: message.expiresInMinutes },
      message.locale,
    );
  }
  return renderEmail(
    'invitation',
    {
      url: message.url,
      expiresInDays: Math.max(1, Math.round(message.expiresInMinutes / (24 * 60))),
      preferencesUrl: preferencesUrl(new URL(message.url).origin),
    },
    message.locale,
  );
}

/** A `Mailer` that renders each auth email and hands it to an email transport. */
export function transportMailer(transport: EmailTransport): Mailer {
  return {
    async send(message) {
      const rendered = await renderAuthEmail(message);
      await transport.send({
        to: message.to,
        ...rendered,
        tags: {
          template: message.template,
          subjectKey: message.subjectKey,
          bodyKey: message.bodyKey,
          locale: message.locale,
          expiresInMinutes: message.expiresInMinutes,
        },
      });
    },
  };
}

/**
 * Logs the rendered email instead of sending it. The plain-text body is in the log message, so the
 * link stands on its own line and terminals make it clickable.
 */
export function consoleMailer(logger: AuthLogger = consoleLogger): Mailer {
  return transportMailer(consoleTransport(logger));
}

/** SMTP delivery (Mailpit in dev). The URL is revealed only to build the transport. */
export function smtpMailer(smtpUrl: Secret, from: string = DEFAULT_FROM): Mailer {
  return transportMailer(smtpTransport(smtpUrl, from));
}

type MailerEnv = Pick<ServerEnv, 'EMAIL_PROVIDER'> & {
  SMTP_URL?: Secret | undefined;
  SES_REGION?: string | undefined;
  SES_ACCESS_KEY_ID?: string | undefined;
  SES_SECRET_ACCESS_KEY?: Secret | undefined;
};

/**
 * Pick the transport for EMAIL_PROVIDER (console, smtp or ses). Missing credentials fall back to the
 * console with a warning, so boot never depends on them.
 */
export function createMailer(env: MailerEnv, logger: AuthLogger = consoleLogger): Mailer {
  return transportMailer(createEmailTransport(env, logger));
}
