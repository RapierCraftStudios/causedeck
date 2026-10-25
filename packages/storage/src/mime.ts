// Upload type hygiene (#217; spike §6 Uploads, ADR 0006). An upload is accepted only when its
// kind, file extension and declared MIME match one allow-list entry, and at finalize only when the
// type sniffed from its bytes is one that entry accepts. Executables, scripts and markup are denied
// outright, whatever the allow-list says. Nothing here parses or renders a document: sniffing reads
// magic bytes (`file-type`) and, for text, checks encoding and the first bytes.
import { fileTypeFromBuffer } from 'file-type';

import type { ObjectKind } from './limits.ts';

export interface AllowedType {
  /** A short name for the type (`pdf`, `docx`, ...). */
  name: string;
  kind: ObjectKind;
  /** Canonical MIME, used as the stored type until finalize replaces it with the sniffed one. */
  mime: string;
  /** Lower-case extensions without the dot. */
  extensions: readonly string[];
  /** MIME types a client may declare for it. */
  declared: readonly string[];
  /** MIME types the sniffer may report for it (parameters stripped). */
  sniffed: readonly string[];
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The upload allow-list: PDF, DOCX, `.ics`, `.txt`, PNG, JPEG, WebP, HEIC, audio and `.zip`. */
export const ALLOWED_TYPES: readonly AllowedType[] = Object.freeze([
  {
    name: 'pdf',
    kind: 'document',
    mime: 'application/pdf',
    extensions: ['pdf'],
    declared: ['application/pdf'],
    sniffed: ['application/pdf'],
  },
  {
    name: 'docx',
    kind: 'document',
    mime: DOCX,
    extensions: ['docx'],
    declared: [DOCX],
    sniffed: [DOCX],
  },
  {
    name: 'ics',
    kind: 'document',
    mime: 'text/calendar',
    extensions: ['ics'],
    declared: ['text/calendar'],
    sniffed: ['text/calendar'],
  },
  {
    name: 'txt',
    kind: 'document',
    mime: 'text/plain',
    extensions: ['txt'],
    declared: ['text/plain'],
    sniffed: ['text/plain', 'text/calendar'],
  },
  {
    name: 'png',
    kind: 'image',
    mime: 'image/png',
    extensions: ['png'],
    declared: ['image/png'],
    sniffed: ['image/png'],
  },
  {
    name: 'jpeg',
    kind: 'image',
    mime: 'image/jpeg',
    extensions: ['jpg', 'jpeg'],
    declared: ['image/jpeg', 'image/jpg'],
    sniffed: ['image/jpeg'],
  },
  {
    name: 'webp',
    kind: 'image',
    mime: 'image/webp',
    extensions: ['webp'],
    declared: ['image/webp'],
    sniffed: ['image/webp'],
  },
  {
    name: 'heic',
    kind: 'image',
    mime: 'image/heic',
    extensions: ['heic', 'heif'],
    declared: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
    sniffed: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
  },
  {
    name: 'm4a',
    kind: 'audio',
    mime: 'audio/mp4',
    extensions: ['m4a'],
    declared: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
    sniffed: ['audio/x-m4a', 'audio/mp4'],
  },
  {
    name: 'mp3',
    kind: 'audio',
    mime: 'audio/mpeg',
    extensions: ['mp3'],
    declared: ['audio/mpeg', 'audio/mp3'],
    sniffed: ['audio/mpeg'],
  },
  {
    name: 'wav',
    kind: 'audio',
    mime: 'audio/wav',
    extensions: ['wav'],
    declared: ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/vnd.wave'],
    sniffed: ['audio/wav', 'audio/vnd.wave'],
  },
  {
    name: 'ogg',
    kind: 'audio',
    mime: 'audio/ogg',
    extensions: ['ogg', 'oga', 'opus'],
    declared: ['audio/ogg', 'audio/opus'],
    sniffed: ['audio/ogg', 'audio/opus'],
  },
  {
    // Browsers record WebM audio; the container sniffs as `video/webm` either way.
    name: 'webm',
    kind: 'audio',
    mime: 'audio/webm',
    extensions: ['webm', 'weba'],
    declared: ['audio/webm', 'video/webm'],
    sniffed: ['audio/webm', 'video/webm'],
  },
  {
    name: 'zip',
    kind: 'zip',
    mime: 'application/zip',
    extensions: ['zip'],
    declared: ['application/zip', 'application/x-zip-compressed'],
    sniffed: ['application/zip'],
  },
]);

/** Extensions that are never accepted, even as the inner part of a double extension. */
// prettier-ignore
const DENIED_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'scr', 'msi', 'msp', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf',
  'wsh', 'hta', 'cpl', 'lnk', 'jar', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'elf', 'so',
  'dylib', 'bin', 'sh', 'bash', 'zsh', 'csh', 'js', 'mjs', 'cjs', 'jse', 'ts', 'py', 'rb', 'pl',
  'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi', 'html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz',
  'xml', 'xsl', 'swf', 'wasm',
]);

/** MIME types (parameters stripped) that are never accepted, declared or sniffed. */
const DENIED_MIME = [
  /^text\/html$/,
  /^application\/xhtml\+xml$/,
  /^image\/svg\+xml$/,
  /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/,
  /^text\/(?:x-)?(?:shellscript|sh|python|perl|php)$/,
  /^application\/x-(?:sh|csh|bat|msdownload|msdos-program|msi|executable|elf|mach-binary|sharedlib|dosexec|httpd-php|python-code|perl)$/,
  /^application\/vnd\.microsoft\.portable-executable$/,
  /^application\/(?:java-archive|x-java-archive|vnd\.android\.package-archive)$/,
  /^application\/(?:xml|x-shockwave-flash|wasm)$/,
  /^text\/xml$/,
];

/** Lower-cased MIME without parameters (`audio/ogg; codecs=opus` → `audio/ogg`). */
export function normalizeMime(mime: string): string {
  return (mime.split(';', 1)[0] ?? '').trim().toLowerCase();
}

export function isDeniedMime(mime: string): boolean {
  const normalized = normalizeMime(mime);
  return DENIED_MIME.some((pattern) => pattern.test(normalized));
}

/** Every dot-separated suffix of the name, lower-cased (`a.pdf.exe` → `pdf`, `exe`). */
function suffixes(filename: string): string[] {
  return filename.toLowerCase().split('.').slice(1);
}

export function hasDeniedExtension(filename: string): boolean {
  return suffixes(filename).some((part) => DENIED_EXTENSIONS.has(part.trim()));
}

/** The allow-list entry for this kind, filename and declared MIME, or `null`. */
export function findAllowedType(
  kind: string,
  filename: string,
  declaredMime: string,
): AllowedType | null {
  if (hasDeniedExtension(filename) || isDeniedMime(declaredMime)) return null;
  const extension = suffixes(filename).at(-1);
  if (extension === undefined) return null;
  const mime = normalizeMime(declaredMime);
  return (
    ALLOWED_TYPES.find(
      (entry) =>
        entry.kind === kind &&
        entry.extensions.includes(extension) &&
        entry.declared.includes(mime),
    ) ?? null
  );
}

/** Markup and script openings a text upload must not start with. */
const MARKUP_START =
  /^(?:<!doctype|<html|<head|<body|<script|<svg|<\?xml|<iframe|<object|<embed|<meta|<!--|#!)/i;

/**
 * The type sniffed from the bytes: what `file-type` reports for binary formats; for text (valid
 * UTF-8, no NUL) `text/calendar` when it opens with `BEGIN:VCALENDAR`, `text/html` when it opens
 * with markup or a shebang, else `text/plain`. `null` when it is neither.
 */
export async function sniffMime(bytes: Uint8Array): Promise<string | null> {
  const detected = await fileTypeFromBuffer(bytes);
  if (detected !== undefined) return normalizeMime(detected.mime);
  if (bytes.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
  const start = text.trimStart();
  if (MARKUP_START.test(start)) return 'text/html';
  if (/^BEGIN:VCALENDAR\r?\n/.test(start)) return 'text/calendar';
  return 'text/plain';
}

/** Whether a sniffed type is acceptable for the allow-list entry chosen at intent. */
export function isCompatible(entry: AllowedType, sniffed: string | null): sniffed is string {
  if (sniffed === null || isDeniedMime(sniffed)) return false;
  return entry.sniffed.includes(normalizeMime(sniffed));
}
