// The link code sender (#711): real provider only with credentials and an approved template name,
// console or refusal otherwise, and the code is never logged.
import { Secret } from '@causedeck/config/env';
import { describe, expect, it } from 'vitest';

import {
  buildOtpBody,
  createWhatsAppOtpSender,
  mockWhatsAppOtpSender,
  WhatsAppDeliveryError,
  type WhatsAppFetch,
} from '../index.ts';

const NUMBER = '+919812345678';
const CODE = '424242';
const provider = { WHATSAPP_PHONE_NUMBER_ID: '1234', WHATSAPP_ACCESS_TOKEN: new Secret('tok') };

function recorder() {
  const calls: { url: string; body: string }[] = [];
  const fetch: WhatsAppFetch = (url, init) => {
    calls.push({ url, body: init.body });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ messages: [{ id: 'wamid.9' }] }),
    });
  };
  return { calls, fetch };
}

function logs() {
  const lines: string[] = [];
  const push = (o: object, m?: string) => lines.push(JSON.stringify([o, m]));
  return { lines, log: { info: push, warn: push } };
}

describe('createWhatsAppOtpSender', () => {
  it('uses the console sender without config, and logs neither code nor number', async () => {
    const { lines, log } = logs();
    const sender = createWhatsAppOtpSender({ env: { NODE_ENV: 'development' }, log });
    const result = await sender.sendOtp({ code: CODE, expiresInMinutes: 10 }, { e164: NUMBER });
    expect(result).toEqual({ messageId: null });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('***5678');
    expect(lines[0]).not.toContain(CODE);
    expect(lines[0]).not.toContain('9812345678');
  });

  it('does not send for real with credentials but no approved template name', async () => {
    const { calls, fetch } = recorder();
    const sender = createWhatsAppOtpSender({ env: { ...provider, NODE_ENV: 'test' }, fetch });
    await sender.sendOtp({ code: CODE, expiresInMinutes: 10 }, { e164: NUMBER });
    expect(calls).toEqual([]);
  });

  it('sends the code as template parameters once provider env and template are set', async () => {
    const { calls, fetch } = recorder();
    const { lines, log } = logs();
    const sender = createWhatsAppOtpSender({
      env: { ...provider, WHATSAPP_OTP_TEMPLATE_NAME: 'approved_otp', NODE_ENV: 'production' },
      fetch,
      log,
    });
    const result = await sender.sendOtp({ code: CODE, expiresInMinutes: 10 }, { e164: NUMBER });
    expect(result).toEqual({ messageId: 'wamid.9' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v21.0/1234/messages');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual(
      buildOtpBody('approved_otp', { code: CODE, expiresInMinutes: 10 }, NUMBER),
    );
    expect(lines.join('')).not.toContain(CODE);
  });

  it('logs no code when the provider rejects, and classifies the failure', async () => {
    const { lines, log } = logs();
    const fetch: WhatsAppFetch = () =>
      Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) });
    const sender = createWhatsAppOtpSender({
      env: { ...provider, WHATSAPP_OTP_TEMPLATE_NAME: 'approved_otp' },
      fetch,
      log,
    });
    const error = await sender
      .sendOtp({ code: CODE, expiresInMinutes: 10 }, { e164: NUMBER })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppDeliveryError);
    expect((error as WhatsAppDeliveryError).permanent).toBe(true);
    expect(lines.join('')).not.toContain(CODE);
    expect((error as Error).message).not.toContain(CODE);
  });

  it('refuses in production without config instead of pretending to send', async () => {
    const sender = createWhatsAppOtpSender({ env: { NODE_ENV: 'production' } });
    await expect(
      sender.sendOtp({ code: CODE, expiresInMinutes: 10 }, { e164: NUMBER }),
    ).rejects.toBeInstanceOf(WhatsAppDeliveryError);
  });

  it('refuses a malformed number before any request', async () => {
    const { calls, fetch } = recorder();
    const sender = createWhatsAppOtpSender({
      env: { ...provider, WHATSAPP_OTP_TEMPLATE_NAME: 'approved_otp' },
      fetch,
    });
    await expect(
      sender.sendOtp({ code: CODE, expiresInMinutes: 10 }, { e164: '12345' }),
    ).rejects.toBeInstanceOf(WhatsAppDeliveryError);
    expect(calls).toEqual([]);
  });

  it('the mock keeps what it was given', async () => {
    const mock = mockWhatsAppOtpSender();
    await mock.sendOtp({ code: CODE, expiresInMinutes: 10 }, { e164: NUMBER });
    expect(mock.outbox).toEqual([{ e164: NUMBER, code: CODE, expiresInMinutes: 10 }]);
  });
});
