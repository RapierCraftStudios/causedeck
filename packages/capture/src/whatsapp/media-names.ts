// Attachment file-name patterns of Android and iOS exports (#525).
import type { MediaKind } from './types.ts';

const BY_PREFIX: readonly [RegExp, MediaKind][] = [
  [/^IMG-\d{8}-WA\d+/i, 'image'],
  [/^VID-\d{8}-WA\d+/i, 'video'],
  [/^(?:AUD|PTT)-\d{8}-WA\d+/i, 'audio'],
  [/^STK-\d{8}-WA\d+/i, 'sticker'],
  [/^DOC-\d{8}-WA\d+/i, 'document'],
  [/^\d{8}-PHOTO-/i, 'image'],
  [/^\d{8}-VIDEO-/i, 'video'],
  [/^\d{8}-(?:AUDIO|PTT)-/i, 'audio'],
  [/^\d{8}-STICKER-/i, 'sticker'],
  [/^\d{8}-GIF-/i, 'video'],
  [/^WhatsApp (?:Audio|Ptt)\b/i, 'audio'],
  [/^WhatsApp (?:Image|Photo)\b/i, 'image'],
  [/^WhatsApp Video\b/i, 'video'],
];

const BY_EXTENSION: readonly [RegExp, MediaKind][] = [
  [/\.(?:jpe?g|png|heic|webp)$/i, 'image'],
  [/\.(?:mp4|mov|3gp|mkv)$/i, 'video'],
  [/\.(?:opus|m4a|mp3|aac|ogg|wav|amr)$/i, 'audio'],
  [/\.(?:pdf|docx?|xlsx?|pptx?|txt|zip|csv)$/i, 'document'],
  [/\.vcf$/i, 'contact'],
];

/** The kind of an exported attachment, from its name (WhatsApp patterns first, then extension). */
export function mediaKindFromName(name: string): MediaKind {
  const trimmed = name.trim();
  for (const [pattern, kind] of BY_PREFIX) if (pattern.test(trimmed)) return kind;
  for (const [pattern, kind] of BY_EXTENSION) if (pattern.test(trimmed)) return kind;
  return 'other';
}

const OMITTED: readonly [RegExp, MediaKind][] = [
  [/^<?(?:media|image|photo) omitted>?$/i, 'image'],
  [/^<?video omitted>?$/i, 'video'],
  [/^<?(?:audio|voice message|ptt) omitted>?$/i, 'audio'],
  [/^<?(?:sticker|gif) omitted>?$/i, 'sticker'],
  [/^<?document omitted>?$/i, 'document'],
  [/^<?contact card omitted>?$/i, 'contact'],
];

/** Detects an attachment marker in a message body, or returns `null` for ordinary text. */
export function detectAttachment(body: string): { name: string | null; kind: MediaKind } | null {
  const text = body.trim();
  const iosAttached = /^<attached:\s*(.+?)>$/i.exec(text);
  if (iosAttached?.[1] !== undefined) {
    const name = iosAttached[1].trim();
    return { name, kind: mediaKindFromName(name) };
  }
  const androidAttached = /^(.+?)\s+\(file attached\)$/i.exec(text);
  if (androidAttached?.[1] !== undefined) {
    const name = androidAttached[1].trim();
    return { name, kind: mediaKindFromName(name) };
  }
  for (const [pattern, kind] of OMITTED) if (pattern.test(text)) return { name: null, kind };
  return null;
}
