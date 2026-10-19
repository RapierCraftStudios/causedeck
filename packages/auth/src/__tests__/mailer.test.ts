import { Secret } from '@causedeck/config/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { consoleMailer, createMailer, type AuthEmail } from '../mailer';
import { AUTH_EMAIL_KEYS } from '../messages';
import { capturingLogger } from './helpers';

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn(() => Promise.resolve({}));
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock('nodemailer', () => ({ createTransport }));

const SMTP_URL = 'smtp://mailpit-user:smtp-password-never-log@localhost:1025';

const message: AuthEmail = {
  to: 'advocate@example.in',
  template: 'auth.magicLink',
  subjectKey: AUTH_EMAIL_KEYS.magicLink.subject,
  bodyKey: AUTH_EMAIL_KEYS.magicLink.body,
  url: 'http://localhost:3000/api/auth/magic-link/verify?token=abc&callbackURL=%2F',
  locale: 'en',
  expiresInMinutes: 10,
};

beforeEach(() => {
  createTransport.mockClear();
  sendMail.mockClear();
});

describe('consoleMailer', () => {
  it('logs the magic link as a standalone clickable URL with i18n keys', async () => {
    const logger = capturingLogger();
    await consoleMailer(logger).send(message);
    expect(logger.lines).toHaveLength(1);
    const line = logger.lines[0] ?? '';
    expect(line.split('\n')).toContain(message.url);
    expect(line).toContain(AUTH_EMAIL_KEYS.magicLink.subject);
    expect(line).toContain(AUTH_EMAIL_KEYS.magicLink.body);
  });

  it('logs a workspace invitation (#178) with its template, i18n keys and link', async () => {
    const logger = capturingLogger();
    const invitation: AuthEmail = {
      to: 'junior@example.in',
      template: 'workspace.invitation',
      subjectKey: AUTH_EMAIL_KEYS.invitation.subject,
      bodyKey: AUTH_EMAIL_KEYS.invitation.body,
      url: 'http://localhost:3000/invite/abc',
      locale: 'en',
      expiresInMinutes: 7 * 24 * 60,
    };
    await consoleMailer(logger).send(invitation);
    expect(logger.lines).toHaveLength(1);
    const line = logger.lines[0] ?? '';
    expect(line.split('\n')).toContain(invitation.url);
    expect(line).toContain('workspace.invitation');
    expect(line).toContain(AUTH_EMAIL_KEYS.invitation.subject);
    expect(line).toContain(AUTH_EMAIL_KEYS.invitation.body);
  });
});

describe('createMailer', () => {
  it('uses the console mailer by default', async () => {
    const logger = capturingLogger();
    await createMailer({ EMAIL_PROVIDER: 'console' }, logger).send(message);
    expect(createTransport).not.toHaveBeenCalled();
    expect(logger.lines.join('\n')).toContain(message.url);
  });

  it('sends through SMTP (Mailpit) when EMAIL_PROVIDER=smtp, never logging the URL secret', async () => {
    const logger = capturingLogger();
    const mailer = createMailer({ EMAIL_PROVIDER: 'smtp', SMTP_URL: new Secret(SMTP_URL) }, logger);
    await mailer.send(message);
    expect(createTransport).toHaveBeenCalledWith(SMTP_URL);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: message.to,
        subject: message.subjectKey,
        text: expect.stringContaining(message.url) as unknown,
      }),
    );
    expect(logger.lines.join('\n')).not.toContain('smtp-password-never-log');
  });

  it('falls back to the console mailer for SES until #23', async () => {
    const logger = capturingLogger();
    await createMailer({ EMAIL_PROVIDER: 'ses' } as never, logger).send(message);
    expect(createTransport).not.toHaveBeenCalled();
    expect(logger.lines.join('\n')).toContain(message.url);
  });
});
