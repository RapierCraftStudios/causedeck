import { Secret } from '@causedeck/config/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderEmail } from '../render.ts';
import { sesTransport } from '../ses-transport.ts';
import { createEmailTransport, type EmailLogger, type EmailMessage } from '../transport.ts';

const ses = vi.hoisted(() => {
  const send = vi.fn<(command: unknown) => Promise<{ MessageId: string }>>(() =>
    Promise.resolve({ MessageId: 'ses-message-1' }),
  );
  const SESv2Client = vi.fn<(config: unknown) => void>(function (this: { send: typeof send }) {
    this.send = send;
  });
  const SendEmailCommand = vi.fn(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  });
  return { send, SESv2Client, SendEmailCommand };
});
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: ses.SESv2Client,
  SendEmailCommand: ses.SendEmailCommand,
}));

const smtp = vi.hoisted(() => {
  const sendMail = vi.fn<(mail: unknown) => Promise<{ messageId: string }>>(() =>
    Promise.resolve({ messageId: 'smtp-message-1' }),
  );
  return {
    sendMail,
    createTransport: vi.fn<(url: string) => { sendMail: typeof sendMail }>(() => ({ sendMail })),
  };
});
vi.mock('nodemailer', () => ({ createTransport: smtp.createTransport }));

const SMTP_URL = 'smtp://mailpit-user:smtp-password-never-log@localhost:1025';
const SES_SECRET = 'ses-secret-never-log';

function capturingLogger(): EmailLogger & { lines: string[] } {
  const lines: string[] = [];
  const write = (obj: object, msg?: string) => {
    lines.push(`${msg ?? ''} ${JSON.stringify(obj)}`);
  };
  return { lines, debug: write, info: write, warn: write, error: write };
}

async function sample(): Promise<EmailMessage> {
  const url = 'http://localhost:3000/api/auth/magic-link/verify?token=abc';
  const rendered = await renderEmail('magic-link', { url, expiresInMinutes: 10 }, 'en');
  return { to: 'advocate@example.in', ...rendered, headers: { 'X-Entity-Ref-ID': 'n-1' } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EMAIL_PROVIDER=console', () => {
  it('logs the rendered email, text included, and renders HTML', async () => {
    const logger = capturingLogger();
    const transport = createEmailTransport({ EMAIL_PROVIDER: 'console' }, logger);
    const message = await sample();
    expect(transport.provider).toBe('console');
    expect(message.html).toMatch(/^<!DOCTYPE html/);
    await transport.send({ ...message, tags: { template: 'magic-link' } });
    expect(logger.lines).toHaveLength(1);
    const line = logger.lines[0] ?? '';
    expect(line).toContain(message.subject);
    expect(line).toContain(message.text);
    expect(line.split('\n')).toContain(
      'http://localhost:3000/api/auth/magic-link/verify?token=abc',
    );
    expect(line).toContain('"template":"magic-link"');
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(ses.SESv2Client).not.toHaveBeenCalled();
  });
});

describe('EMAIL_PROVIDER=smtp (Mailpit)', () => {
  it('sends HTML and text through nodemailer without logging the URL secret', async () => {
    const logger = capturingLogger();
    const transport = createEmailTransport(
      { EMAIL_PROVIDER: 'smtp', SMTP_URL: new Secret(SMTP_URL) },
      logger,
    );
    const message = await sample();
    const result = await transport.send(message);
    expect(transport.provider).toBe('smtp');
    expect(smtp.createTransport).toHaveBeenCalledWith(SMTP_URL);
    expect(smtp.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      }),
    );
    expect(result.messageId).toBe('smtp-message-1');
    expect(logger.lines.join('\n')).not.toContain('smtp-password-never-log');
  });
});

describe('EMAIL_PROVIDER=ses', () => {
  it('invokes the SES v2 client in ap-south-1 with HTML and text', async () => {
    const logger = capturingLogger();
    const transport = createEmailTransport(
      {
        EMAIL_PROVIDER: 'ses',
        SES_REGION: 'ap-south-1',
        SES_ACCESS_KEY_ID: 'AKIA-TEST',
        SES_SECRET_ACCESS_KEY: new Secret(SES_SECRET),
      },
      logger,
    );
    const message = await sample();
    const result = await transport.send(message);
    expect(transport.provider).toBe('ses');
    expect(ses.SESv2Client).toHaveBeenCalledWith({
      region: 'ap-south-1',
      credentials: { accessKeyId: 'AKIA-TEST', secretAccessKey: SES_SECRET },
    });
    expect(ses.SendEmailCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
            Headers: [{ Name: 'X-Entity-Ref-ID', Value: 'n-1' }],
          },
        },
      }),
    );
    expect(ses.send).toHaveBeenCalledTimes(1);
    expect(result.messageId).toBe('ses-message-1');
    expect(logger.lines.join('\n')).not.toContain(SES_SECRET);
  });

  it('defaults to ap-south-1', () => {
    sesTransport({ accessKeyId: 'id', secretAccessKey: new Secret('s'), from: 'a@b.in' });
    expect(ses.SESv2Client).toHaveBeenCalledWith(expect.objectContaining({ region: 'ap-south-1' }));
  });

  it.each(['us-east-1', 'eu-west-1', 'ap-southeast-1'])(
    'rejects the non-India region %s',
    (region) => {
      expect(() =>
        createEmailTransport(
          {
            EMAIL_PROVIDER: 'ses',
            SES_REGION: region,
            SES_ACCESS_KEY_ID: 'id',
            SES_SECRET_ACCESS_KEY: new Secret('secret'),
          },
          capturingLogger(),
        ),
      ).toThrow(/India region/);
      expect(ses.SESv2Client).not.toHaveBeenCalled();
    },
  );

  it('allows another region only with the explicit AWS_REGION_OVERRIDE_ACK', () => {
    const transport = createEmailTransport(
      {
        EMAIL_PROVIDER: 'ses',
        SES_REGION: 'us-east-1',
        SES_ACCESS_KEY_ID: 'id',
        SES_SECRET_ACCESS_KEY: new Secret('secret'),
        AWS_REGION_OVERRIDE_ACK: 'I_UNDERSTAND',
      },
      capturingLogger(),
    );
    expect(transport.provider).toBe('ses');
    expect(ses.SESv2Client).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1' }));
  });
});

describe('selection by env only', () => {
  it('falls back to the console when SES credentials are absent, without throwing', async () => {
    const logger = capturingLogger();
    const transport = createEmailTransport({ EMAIL_PROVIDER: 'ses' }, logger);
    expect(transport.provider).toBe('console');
    expect(logger.lines.join('\n')).toContain('SES credentials are not set');
    await transport.send(await sample());
    expect(ses.SESv2Client).not.toHaveBeenCalled();
  });

  it('falls back to the console when SMTP_URL is absent', () => {
    const transport = createEmailTransport({ EMAIL_PROVIDER: 'smtp' }, capturingLogger());
    expect(transport.provider).toBe('console');
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it('picks a different real transport from the same code when only env changes', () => {
    const logger = capturingLogger();
    const providers = [
      createEmailTransport({ EMAIL_PROVIDER: 'console' }, logger),
      createEmailTransport({ EMAIL_PROVIDER: 'smtp', SMTP_URL: new Secret(SMTP_URL) }, logger),
      createEmailTransport(
        {
          EMAIL_PROVIDER: 'ses',
          SES_REGION: 'ap-south-1',
          SES_ACCESS_KEY_ID: 'id',
          SES_SECRET_ACCESS_KEY: new Secret('secret'),
        },
        logger,
      ),
    ].map((transport) => transport.provider);
    expect(providers).toEqual(['console', 'smtp', 'ses']);
  });
});
