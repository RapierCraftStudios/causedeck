// Email layout reader (#396, ADR 0015): a message the lawyer forwarded (RFC 5322 with MIME parts)
// as headers, a part tree and a `LayoutDocument`. Handles folded headers, RFC 2047 encoded words,
// multipart bodies, base64 and quoted-printable transfer encodings, utf-8 and iso-8859-1 charsets
// and attached messages (`message/rfc822`, read recursively). A byte input is read as utf-8.
// Pure and total: a malformed message gives what could be read, never an exception.
import { layoutFromHtml } from './html.ts';

import type { LayoutDocument } from '../types.ts';

export interface EmailPart {
  /** MIME part path: `1`, `2`, `1.2`. */
  ref: string;
  /** Lower-case media type, e.g. `text/plain`. */
  contentType: string;
  headers: Readonly<Record<string, string>>;
  fileName?: string;
  /** Disposition `attachment`, or a named non-text part. */
  isAttachment: boolean;
  /** Decoded text of a `text/*` part. */
  text?: string;
  /** Decoded bytes of any leaf part. */
  content?: Uint8Array;
  /** The message a `message/rfc822` part holds. */
  message?: EmailMessage;
  /** Children of a `multipart/*` part. */
  parts?: EmailPart[];
}

export interface EmailMessage {
  /** Header names lower-case; the first occurrence wins; values unfolded and decoded. */
  headers: Readonly<Record<string, string>>;
  subject: string;
  date: string | null;
  /** The message body as a part tree (a single-part message is one leaf with ref `1`). */
  body: EmailPart;
}

const MAX_DEPTH = 8;

interface ContentType {
  type: string;
  params: Record<string, string>;
}

function parseParams(value: string): ContentType {
  const [type = '', ...rest] = value.split(';');
  const params: Record<string, string> = {};
  for (const param of rest) {
    const eq = param.indexOf('=');
    if (eq < 0) continue;
    const key = param.slice(0, eq).trim().toLowerCase();
    const raw = param.slice(eq + 1).trim();
    params[key] = raw.startsWith('"') ? raw.replace(/^"|"$/g, '') : raw;
  }
  return { type: type.trim().toLowerCase(), params };
}

/** `bytes` as text in `charset`; an unknown charset is read as utf-8. */
function decodeBytes(bytes: Uint8Array, charset: string | undefined): string {
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function base64Bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64'));
}

const encoder = new TextEncoder();

function quotedPrintableBytes(text: string, header = false): Uint8Array {
  const bytes: number[] = [];
  const source = text.replace(/=\r?\n/g, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? '';
    const hex = source.slice(i + 1, i + 3);
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else if (header && char === '_') {
      bytes.push(0x20);
    } else {
      bytes.push(...encoder.encode(char));
    }
  }
  return new Uint8Array(bytes);
}

/** Decodes RFC 2047 encoded words (`=?utf-8?B?...?=`, `=?iso-8859-1?Q?...?=`). */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(
      /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
      (_, charset: string, kind: string, data: string) =>
        decodeBytes(
          kind.toUpperCase() === 'B' ? base64Bytes(data) : quotedPrintableBytes(data, true),
          charset,
        ),
    );
}

function splitHead(raw: string): { head: string; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  if (match === null) return { head: raw, body: '' };
  return { head: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) };
}

function parseHeaders(head: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!/^[!-9;-~]+$/.test(name) || name in headers) continue;
    headers[name] = decodeEncodedWords(line.slice(colon + 1).trim());
  }
  return headers;
}

function splitMultipart(body: string, boundary: string): string[] {
  const parts: string[] = [];
  const delimiter = `--${boundary}`;
  let current: string[] | null = null;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed === `${delimiter}--`) break;
    if (trimmed === delimiter) {
      if (current !== null) parts.push(current.join('\n'));
      current = [];
      continue;
    }
    current?.push(line);
  }
  if (current !== null) parts.push(current.join('\n'));
  return parts;
}

function readPart(raw: string, ref: string, depth: number): EmailPart {
  const { head, body } = splitHead(raw);
  return partOf(parseHeaders(head), body, ref, depth);
}

function partOf(
  headers: Record<string, string>,
  body: string,
  ref: string,
  depth: number,
): EmailPart {
  const contentType = parseParams(headers['content-type'] ?? 'text/plain');
  const disposition = parseParams(headers['content-disposition'] ?? '');
  const fileName = disposition.params.filename ?? contentType.params.name;
  const base = {
    ref,
    contentType: contentType.type === '' ? 'text/plain' : contentType.type,
    headers,
    ...(fileName === undefined ? {} : { fileName }),
  };
  const boundary = contentType.params.boundary;
  if (base.contentType.startsWith('multipart/') && boundary !== undefined && depth < MAX_DEPTH) {
    const parts = splitMultipart(body, boundary).map((partRaw, index) =>
      readPart(partRaw, ref === '' ? String(index + 1) : `${ref}.${String(index + 1)}`, depth + 1),
    );
    return { ...base, ref: ref === '' ? '1' : ref, isAttachment: false, parts };
  }
  const partRef = ref === '' ? '1' : ref;
  const encoding = (headers['content-transfer-encoding'] ?? '7bit').trim().toLowerCase();
  const content =
    encoding === 'base64'
      ? base64Bytes(body)
      : encoding === 'quoted-printable'
        ? quotedPrintableBytes(body)
        : encoder.encode(body);
  const isAttachment =
    disposition.type === 'attachment' ||
    (fileName !== undefined && !base.contentType.startsWith('text/'));
  if (base.contentType === 'message/rfc822' && depth < MAX_DEPTH) {
    return {
      ...base,
      ref: partRef,
      isAttachment,
      message: readMessageAt(new TextDecoder('utf-8').decode(content), depth + 1),
    };
  }
  if (base.contentType.startsWith('text/')) {
    // 7bit and 8bit bodies are already text; only transfer-encoded bytes need the charset.
    const decoded =
      encoding === 'base64' || encoding === 'quoted-printable'
        ? decodeBytes(content, contentType.params.charset)
        : body;
    const text = decoded.replaceAll(/\r\n?/g, '\n');
    return { ...base, ref: partRef, isAttachment, text, content };
  }
  return { ...base, ref: partRef, isAttachment, content };
}

function readMessageAt(raw: string, depth: number): EmailMessage {
  const { head, body } = splitHead(raw);
  const headers = parseHeaders(head);
  return {
    headers,
    subject: headers.subject ?? '',
    date: headers.date ?? null,
    body: partOf(headers, body, '', depth),
  };
}

/** Reads a raw message (RFC 5322) into headers and a decoded part tree. */
export function readEmail(raw: string | Uint8Array): EmailMessage {
  const text = typeof raw === 'string' ? raw : new TextDecoder('utf-8').decode(raw);
  return readMessageAt(text, 0);
}

/** Every leaf part of `part`, depth first; attached messages are not entered. */
export function emailLeaves(part: EmailPart): EmailPart[] {
  return part.parts === undefined ? [part] : part.parts.flatMap(emailLeaves);
}

/** The attachments of a message (attached messages included), depth first. */
export function emailAttachments(message: EmailMessage): EmailPart[] {
  return emailLeaves(message.body).flatMap((part) => [
    ...(part.isAttachment ? [part] : []),
    ...(part.message === undefined ? [] : emailAttachments(part.message)),
  ]);
}

/** The readable body of a message: the first plain-text part, else the text of the first HTML one. */
export function emailBodyText(message: EmailMessage): string {
  const leaves = emailLeaves(message.body).filter((part) => !part.isAttachment);
  const plain = leaves.find((part) => part.contentType === 'text/plain');
  if (plain?.text !== undefined) return plain.text;
  const html = leaves.find((part) => part.contentType === 'text/html');
  return html?.text === undefined ? '' : (layoutFromHtml(html.text).pages[0]?.text ?? '');
}

/** The message and the messages attached to it, depth first: one page each in `layoutFromEmail`. */
export function emailMessages(message: EmailMessage): EmailMessage[] {
  return [
    message,
    ...emailLeaves(message.body).flatMap((part) =>
      part.message === undefined ? [] : emailMessages(part.message),
    ),
  ];
}

/**
 * Reads a raw message as a `LayoutDocument`: one page per message (attached messages follow), each
 * `Subject:` and `Date:` lines, a blank line, then the readable body.
 */
export function layoutFromEmail(raw: string | Uint8Array): LayoutDocument {
  return {
    pages: emailMessages(readEmail(raw)).map((message, index) => {
      const text = `Subject: ${message.subject}\nDate: ${message.date ?? ''}\n\n${emailBodyText(message)}`;
      return {
        page: index + 1,
        width: 0,
        height: 0,
        text,
        items: [],
        words: [],
        textCoverage: emailBodyText(message).trim() === '' ? 0 : 1,
      };
    }),
  };
}
