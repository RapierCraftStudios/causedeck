// The worker's work, kept pure so it is testable without a Worker (#527): read a WhatsApp export
// (a `.zip` with the chat text, or the bare `.txt`), parse it and flag the messages the exclusion
// rules hold back. Runs in the browser only; the text is never sent anywhere from here.
import {
  matchExclusions,
  parseWhatsAppExport,
  type DateOrder,
  type ParsedMessage,
} from '@causedeck/capture/whatsapp';
import { strFromU8, unzipSync } from 'fflate';

import type { ImportRow, ParseFailure, ParsedChat } from './types.ts';

/** A chat export is capped at 5 MB of text (#43); the zip may carry media on top of that. */
export const MAX_CHAT_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;

export class ParseChatError extends Error {
  constructor(readonly reason: ParseFailure) {
    super(reason);
    this.name = 'ParseChatError';
  }
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

export function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, i) => bytes[i] === byte);
}

/** The chat title from `WhatsApp Chat with X.zip` / `WhatsApp Chat - X.txt`; falls back to the name. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.(?:zip|txt)$/i, '').trim();
  const match = /^WhatsApp Chat(?: with| -)\s+(.+)$/i.exec(base);
  return (match?.[1] ?? base).trim();
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The chat text of an export: the zip's `.txt` (the largest, `_chat.txt` first) or the bytes. */
export function extractChatText(bytes: Uint8Array): string {
  if (!isZip(bytes)) {
    if (bytes.byteLength > MAX_CHAT_TEXT_BYTES) throw new ParseChatError('too_large');
    return strFromU8(bytes);
  }
  if (bytes.byteLength > MAX_ZIP_BYTES) throw new ParseChatError('too_large');
  let entries: Record<string, Uint8Array>;
  try {
    // Only text entries are inflated; the media in the zip is never read here.
    entries = unzipSync(bytes, {
      filter: (file) => /\.txt$/i.test(file.name) && file.originalSize <= MAX_CHAT_TEXT_BYTES,
    });
  } catch {
    throw new ParseChatError('not_zip');
  }
  const names = Object.keys(entries).filter((name) => !name.startsWith('__MACOSX/'));
  const pick =
    names.find((name) => /(?:^|\/)_chat\.txt$/i.test(name)) ??
    [...names].sort((a, b) => (entries[b]?.byteLength ?? 0) - (entries[a]?.byteLength ?? 0))[0];
  const chat = pick === undefined ? undefined : entries[pick];
  if (chat === undefined) throw new ParseChatError('no_chat');
  return strFromU8(chat);
}

function toRow(message: ParsedMessage): ImportRow | null {
  if (message.system || message.deleted || message.sender === null || message.at === null) {
    return null;
  }
  const mediaRef = message.attachment?.name ?? undefined;
  if (message.text.trim() === '' && mediaRef === undefined) return null;
  const rules = matchExclusions(
    mediaRef === undefined ? message.text : `${message.text}\n${mediaRef}`,
  );
  return {
    id: String(message.index),
    ts: message.at,
    sender: message.sender,
    text: message.text,
    ...(mediaRef === undefined ? {} : { mediaRef }),
    rules,
  };
}

export async function parseChat(
  bytes: Uint8Array,
  fileName: string,
  options: { dateOrder?: DateOrder } = {},
): Promise<ParsedChat> {
  const text = extractChatText(bytes);
  const parsed = parseWhatsAppExport(text, options);
  const rows = parsed.messages.flatMap((m) => {
    const row = toRow(m);
    return row === null ? [] : [row];
  });
  if (rows.length === 0) throw new ParseChatError('empty');
  const title = titleFromFileName(fileName);
  return {
    title,
    titleHash: await sha256Hex(title),
    dateOrder: parsed.dateOrder,
    dateOrderAmbiguous: parsed.dateOrderAmbiguous,
    senders: [...new Set(rows.map((r) => r.sender))],
    rows,
  };
}
