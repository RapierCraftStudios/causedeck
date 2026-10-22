// MIME reader for forwarded intake mail (#528). `postal-mime` parses headers, text and html parts,
// attachments and `message/rfc822` parts; this wraps it into the `ParsedEmail` the parsers read.
// Pure: nothing is fetched and no attachment is opened.
import PostalMime from 'postal-mime';

import { htmlToText } from './sanitize.ts';
import type { AuthVerdict, EmailAddress, EmailAttachment, EmailAuth, ParsedEmail } from './types.ts';

const MAX_DEPTH = 4;

const toBytes = (raw: string | Uint8Array): Uint8Array =>
  typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;

const address = (value: { name?: string | undefined; address?: string | undefined } | undefined) =>
  ({ name: value?.name ?? '', address: (value?.address ?? '').toLowerCase() }) satisfies EmailAddress;

function verdict(headerValue: string, mechanism: string): AuthVerdict {
  const match = new RegExp(String.raw`\b${mechanism}\s*=\s*([a-z]+)`, 'i').exec(headerValue);
  const result = match?.[1]?.toLowerCase();
  if (result === undefined) return 'none';
  if (result === 'pass') return 'pass';
  if (['fail', 'softfail', 'permerror', 'temperror'].includes(result)) return 'fail';
  return 'none';
}

/** SPF, DKIM and DMARC verdicts: `Authentication-Results` first, `Received-SPF` for SPF. */
export function readAuth(headers: Readonly<Record<string, string>>): EmailAuth {
  const results = headers['authentication-results'] ?? '';
  const spf = verdict(results, 'spf');
  const receivedSpf = /^\s*([a-z]+)/i.exec(headers['received-spf'] ?? '')?.[1]?.toLowerCase();
  return {
    spf:
      spf !== 'none'
        ? spf
        : receivedSpf === 'pass'
          ? 'pass'
          : receivedSpf === 'fail' || receivedSpf === 'softfail'
            ? 'fail'
            : 'none',
    dkim: verdict(results, 'dkim'),
    dmarc: verdict(results, 'dmarc'),
  };
}

function isoDate(value: string | undefined): string | null {
  if (value === undefined) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Parses an RFC 5322 message; forwarded `message/rfc822` attachments are parsed recursively. */
export async function parseEmail(raw: string | Uint8Array, depth = 0): Promise<ParsedEmail> {
  const bytes = toBytes(raw);
  const parsed = await PostalMime.parse(bytes);
  const headers: Record<string, string> = {};
  for (const header of parsed.headers) headers[header.key] ??= header.value;

  const attachments: EmailAttachment[] = [];
  const forwarded: ParsedEmail[] = [];
  for (const part of parsed.attachments) {
    const content = new Uint8Array(
      typeof part.content === 'string' ? new TextEncoder().encode(part.content) : part.content,
    );
    const contentType = part.mimeType.toLowerCase();
    if (contentType === 'message/rfc822') {
      if (depth < MAX_DEPTH) forwarded.push(await parseEmail(content, depth + 1));
      continue;
    }
    attachments.push({ fileName: part.filename ?? 'attachment', contentType, content });
  }

  const text = parsed.text?.trim() || (parsed.html === undefined ? '' : htmlToText(parsed.html));
  return {
    messageId: parsed.messageId ?? null,
    from: address(parsed.from),
    to: (parsed.to ?? []).map((to) => address(to)),
    subject: parsed.subject ?? '',
    date: isoDate(parsed.date),
    headers,
    text,
    attachments,
    forwarded,
    auth: readAuth(headers),
    raw: bytes,
  };
}
