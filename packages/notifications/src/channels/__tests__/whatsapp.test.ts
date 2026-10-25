// The WhatsApp sender (#679, D-029): disabled without provider env, sends approved templates only
// to the target it is given, re-checks the number, and classifies provider failures.
import { Secret } from '@causedeck/config/env';
import { describe, expect, it } from 'vitest';

import {
  createWhatsAppSender,
  hasWhatsAppTemplate,
  WHATSAPP_TEMPLATES,
  WhatsAppDeliveryError,
  type buildTemplateBody,
  type WhatsAppFetch,
} from '../index.ts';

const env = { WHATSAPP_PHONE_NUMBER_ID: '1234', WHATSAPP_ACCESS_TOKEN: new Secret('tok-secret') };

function recorder(status = 200, body: unknown = { messages: [{ id: 'wamid.1' }] }) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch: WhatsAppFetch = (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
  return { calls, fetch };
}

describe('createWhatsAppSender', () => {
  it('is disabled without the provider env', () => {
    expect(createWhatsAppSender({ env: {} })).toBeUndefined();
    expect(createWhatsAppSender({ env: { WHATSAPP_PHONE_NUMBER_ID: '1' } })).toBeUndefined();
  });

  it('sends one approved template to the given target and nobody else', async () => {
    const { calls, fetch } = recorder();
    const sender = createWhatsAppSender({ env, fetch });
    const result = await sender?.send(
      { category: 'court.board', params: ['https://app.test/w/x'] },
      { e164: '+919812345678' },
    );
    expect(result).toEqual({ messageId: 'wamid.1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v21.0/1234/messages');
    expect(calls[0]?.headers.authorization).toBe('Bearer tok-secret');
    const body = JSON.parse(calls[0]?.body ?? '{}') as ReturnType<typeof buildTemplateBody>;
    expect(body.to).toBe('919812345678');
    expect(body.template.name).toBe(WHATSAPP_TEMPLATES['court.board']);
    expect(body.template.components[0]?.parameters).toEqual([
      { type: 'text', text: 'https://app.test/w/x' },
    ]);
    expect(calls[0]?.body.match(/9198\d+/g)).toEqual(['919812345678']);
  });

  it('refuses a target that is not an E.164 number, without calling the provider', async () => {
    const { calls, fetch } = recorder();
    const sender = createWhatsAppSender({ env, fetch });
    for (const e164 of ['9812345678', '+0123456789', '+91 98123 45678', '', '+91981234567890123']) {
      await expect(
        sender?.send({ category: 'status.order', params: [] }, { e164 }),
      ).rejects.toMatchObject({ permanent: true });
    }
    expect(calls).toHaveLength(0);
  });

  it('classifies provider failures: 4xx permanent, 429, 5xx and network retryable', async () => {
    const failure = async (status: number) => {
      const { fetch } = recorder(status, {});
      const sender = createWhatsAppSender({ env, fetch });
      return sender
        ?.send(
          { category: 'digest.end_of_day', params: ['1', '2', 'u'] },
          { e164: '+919812345678' },
        )
        .catch((error: unknown) => error);
    };
    expect(await failure(400)).toMatchObject({ status: 400, permanent: true });
    expect(await failure(429)).toMatchObject({ status: 429, permanent: false });
    expect(await failure(503)).toMatchObject({ status: 503, permanent: false });
    const sender = createWhatsAppSender({ env, fetch: () => Promise.reject(new Error('boom')) });
    const error = await sender
      ?.send({ category: 'court.board', params: [] }, { e164: '+919812345678' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppDeliveryError);
    expect(error).toMatchObject({ permanent: false });
  });

  it('has templates for exactly the alert and digest categories', () => {
    expect(hasWhatsAppTemplate('court.board')).toBe(true);
    expect(hasWhatsAppTemplate('status.order')).toBe(true);
    expect(hasWhatsAppTemplate('digest.end_of_day')).toBe(true);
    expect(hasWhatsAppTemplate('security.alert')).toBe(false);
  });
});
