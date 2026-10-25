// The Meta WhatsApp Cloud API as an inbound provider (#680). The webhook is signed with
// `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret); a call without a valid
// signature yields nothing. Only document, audio (voice notes included) and image messages are
// read: text and everything else is ignored. Media is a two-step download: the media id resolves
// to a short-lived URL, which is fetched with the same access token.
import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  WhatsAppMediaTooLargeError,
  type WhatsAppInboundMessage,
  type WhatsAppInboundProvider,
  type WhatsAppInboundVerification,
} from './types.ts';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const MESSAGE_ID = /^[\x21-\x7e]{1,255}$/;
const MEDIA_ID = /^[\w.-]{1,128}$/;
const DIGITS = /^[1-9][0-9]{7,14}$/;
const GRAPH = 'https://graph.facebook.com/v21.0';
const MEDIA_KINDS = ['document', 'audio', 'image'] as const;

export interface MetaWhatsAppConfig {
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  fetch?: typeof fetch;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function validSignature(header: string | undefined, body: string, secret: string): boolean {
  if (header === undefined || secret === '' || !header.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function sameSecret(given: string, expected: string): boolean {
  if (expected === '') return false;
  const digest = (value: string) => createHmac('sha256', 'verify-token').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** The media messages of a webhook payload; anything malformed is skipped. */
export function parseMetaMessages(payload: unknown): WhatsAppInboundMessage[] {
  const out: WhatsAppInboundMessage[] = [];
  for (const entry of list(record(payload)['entry'])) {
    for (const change of list(record(entry)['changes'])) {
      for (const raw of list(record(record(change)['value'])['messages'])) {
        const message = record(raw);
        const kind = MEDIA_KINDS.find((k) => k === message['type']);
        if (kind === undefined) continue;
        const media = record(message[kind]);
        const id = text(message['id']);
        const from = text(message['from']);
        const mediaId = text(media['id']);
        if (!MESSAGE_ID.test(id) || !DIGITS.test(from) || !MEDIA_ID.test(mediaId)) continue;
        out.push({
          providerMessageId: id,
          from: `+${from}`,
          mediaId,
          mime: text(media['mime_type']),
          filename: text(media['filename']),
        });
      }
    }
  }
  return out;
}

export function createMetaWhatsAppProvider(config: MetaWhatsAppConfig): WhatsAppInboundProvider {
  const doFetch = config.fetch ?? fetch;
  const auth = { authorization: `Bearer ${config.accessToken}` };

  async function download(url: string, maxBytes: number): Promise<Uint8Array> {
    const response = await doFetch(url, { headers: auth });
    if (!response.ok) throw new Error(`whatsapp media download failed: ${String(response.status)}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > maxBytes) throw new WhatsAppMediaTooLargeError();
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new WhatsAppMediaTooLargeError();
    return bytes;
  }

  return {
    id: 'meta',
    verify: (request): Promise<WhatsAppInboundVerification> => {
      if (!validSignature(request.headers[SIGNATURE_HEADER], request.body, config.appSecret)) {
        return Promise.resolve({ ok: false, reason: 'bad_signature' });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(request.body);
      } catch {
        return Promise.resolve({ ok: false, reason: 'bad_body' });
      }
      return Promise.resolve({ ok: true, messages: parseMetaMessages(payload) });
    },
    challenge: (query) =>
      query.mode === 'subscribe' &&
      query.challenge !== undefined &&
      query.verifyToken !== undefined &&
      sameSecret(query.verifyToken, config.verifyToken)
        ? query.challenge
        : null,
    fetchMedia: async (mediaId, maxBytes) => {
      if (!MEDIA_ID.test(mediaId)) throw new Error('invalid whatsapp media id');
      const meta = await doFetch(`${GRAPH}/${mediaId}`, { headers: auth });
      if (!meta.ok) throw new Error(`whatsapp media lookup failed: ${String(meta.status)}`);
      const url = text(record(await meta.json())['url']);
      if (!url.startsWith('https://')) throw new Error('whatsapp media has no download url');
      return download(url, maxBytes);
    },
  };
}
