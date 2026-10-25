import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createMetaWhatsAppProvider, resolveWhatsAppMedia } from '../index.ts';

const SECRET = 'app-secret';
const provider = createMetaWhatsAppProvider({
  appSecret: SECRET,
  verifyToken: 'verify-me',
  accessToken: 'token',
  fetch: (url) =>
    Promise.resolve(
      (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes(
        'graph.facebook.com',
      )
        ? Response.json({ url: 'https://media.test/file' })
        : new Response(new Uint8Array([1, 2, 3, 4])),
    ),
});

const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const payload = (messages: object[]) =>
  JSON.stringify({ entry: [{ changes: [{ value: { messages } }] }] });

describe('Meta WhatsApp inbound provider', () => {
  it('rejects a missing or wrong signature', async () => {
    const body = payload([]);
    for (const header of [undefined, sign(body, 'other'), 'sha256=zz', 'nope']) {
      const result = await provider.verify({ headers: { 'x-hub-signature-256': header }, body });
      expect(result).toEqual({ ok: false, reason: 'bad_signature' });
    }
  });

  it('reads document, audio and image messages and ignores text and malformed ones', async () => {
    const body = payload([
      {
        id: 'wamid.1',
        from: '919800000001',
        type: 'document',
        document: { id: '111', mime_type: 'application/pdf', filename: 'order.pdf' },
      },
      {
        id: 'wamid.2',
        from: '919800000001',
        type: 'audio',
        audio: { id: '222', mime_type: 'audio/ogg; codecs=opus' },
      },
      { id: 'wamid.3', from: '919800000001', type: 'text', text: { body: 'hi' } },
      { id: 'wamid.4', from: 'abc', type: 'image', image: { id: '1', mime_type: 'image/png' } },
    ]);
    const result = await provider.verify({
      headers: { 'x-hub-signature-256': sign(body) },
      body,
    });
    expect(result).toEqual({
      ok: true,
      messages: [
        {
          providerMessageId: 'wamid.1',
          from: '+919800000001',
          mediaId: '111',
          mime: 'application/pdf',
          filename: 'order.pdf',
        },
        {
          providerMessageId: 'wamid.2',
          from: '+919800000001',
          mediaId: '222',
          mime: 'audio/ogg; codecs=opus',
          filename: '',
        },
      ],
    });
  });

  it('answers the subscription handshake only for the verify token', () => {
    const query = { mode: 'subscribe', challenge: '42' };
    expect(provider.challenge({ ...query, verifyToken: 'verify-me' })).toBe('42');
    expect(provider.challenge({ ...query, verifyToken: 'wrong' })).toBeNull();
    expect(provider.challenge({ mode: 'subscribe', verifyToken: 'verify-me' })).toBeNull();
  });

  it('downloads media and refuses one over the cap', async () => {
    expect(await provider.fetchMedia('111', 10)).toEqual(new Uint8Array([1, 2, 3, 4]));
    await expect(provider.fetchMedia('111', 3)).rejects.toThrow('too large');
    await expect(provider.fetchMedia('../x', 10)).rejects.toThrow('invalid');
  });
});

describe('resolveWhatsAppMedia', () => {
  it('allows a PDF, and a voice note without a filename', () => {
    expect(resolveWhatsAppMedia('application/pdf', 'order.pdf')?.type.name).toBe('pdf');
    const voice = resolveWhatsAppMedia('audio/ogg; codecs=opus', '');
    expect(voice?.type.name).toBe('ogg');
    expect(voice?.filename).toBe('whatsapp-media.ogg');
  });

  it('refuses types off the allow-list and a filename that disagrees with its MIME', () => {
    expect(resolveWhatsAppMedia('video/mp4', 'clip.mp4')).toBeNull();
    expect(resolveWhatsAppMedia('application/x-msdownload', 'a.exe')).toBeNull();
    expect(resolveWhatsAppMedia('text/html', 'page.html')).toBeNull();
  });

  it('never keeps a path from the filename', () => {
    expect(resolveWhatsAppMedia('application/pdf', '../../etc/passwd.pdf')?.filename).toBe(
      'passwd.pdf',
    );
  });
});
