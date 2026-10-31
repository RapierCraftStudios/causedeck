// The type allow-list for forwarded WhatsApp media (#680): documents (PDF, DOCX), voice notes and
// audio, and images, decided by the capture allow-list from the declared MIME and an extension
// (taken from the filename, or from the MIME for a voice note that has none). The sniffed bytes
// are checked again when the media is stored.
import { resolveAllowedType, UnsupportedTypeError } from '../allow-list.ts';

import type { AllowedType } from '@causedeck/storage';

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_FILENAME = 120;

export interface WhatsAppMedia {
  type: AllowedType;
  /** A safe filename carrying an extension the allow-list accepts for the type. */
  filename: string;
}

function safeName(filename: string): string {
  const base = filename.split(/[\\/]/).at(-1) ?? '';
  return base.replace(/[^\w. -]/g, '_').slice(0, MAX_FILENAME);
}

/** The allow-list entry and filename for forwarded media, or `null` when the type is not allowed. */
export function resolveWhatsAppMedia(mime: string, filename: string): WhatsAppMedia | null {
  const declared = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  const candidates = [safeName(filename)];
  const extension = EXTENSION_BY_MIME[declared];
  if (extension !== undefined) candidates.push(`whatsapp-media.${extension}`);
  for (const candidate of candidates) {
    if (candidate === '') continue;
    try {
      const type = resolveAllowedType(candidate, declared);
      // Inert HTML (#567) is an import type; forwarded WhatsApp media never carries markup.
      if (type.allowMarkup === true) continue;
      return { type, filename: candidate };
    } catch (error) {
      if (!(error instanceof UnsupportedTypeError)) throw error;
    }
  }
  return null;
}
