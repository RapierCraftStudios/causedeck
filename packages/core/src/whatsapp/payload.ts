// The `whatsapp_export` upload payload (#526) and the text it is re-parsed from. The browser parses
// and filters the export for the user's benefit; the server rebuilds an export-format text from
// the messages it was sent and runs `validateSelection` over it, so the exclusion rules and limits
// are applied by the server, never taken on trust.
import {
  ALLOWED_TYPES,
  MAX_SELECTED_MESSAGES,
  mediaKindFromName,
  type DateOrder,
  type MediaKind,
} from '@causedeck/capture';
import { z } from 'zod';

const MEDIA_NAME_MAX = 255;

export const WhatsAppImportInput = z.strictObject({
  /** sha256 of the chat title; the title itself never leaves the browser. */
  chatTitleHash: z.string().regex(/^[0-9a-f]{64}$/),
  chatType: z.enum(['internal', 'client']),
  /** The chat type the import was opened for; defaults to `internal`. */
  openedFor: z.enum(['internal', 'client']).default('internal'),
  dateOrder: z.enum(['dmy', 'mdy']),
  messages: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(64),
        /** Local wall-clock `YYYY-MM-DDTHH:mm[:ss]`. */
        ts: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/),
        sender: z.string().trim().min(1).max(200),
        text: z.string().max(20_000),
        /** The attachment's file name; the bytes go through the upload pipeline. */
        mediaRef: z.string().trim().min(1).max(MEDIA_NAME_MAX).optional(),
      }),
    )
    .min(1)
    .max(MAX_SELECTED_MESSAGES),
  /** Ids the user confirmed despite an overridable exclusion. */
  confirmedIds: z.array(z.string().min(1).max(64)).max(MAX_SELECTED_MESSAGES).optional(),
  matterHintId: z.uuid().optional(),
});

export type WhatsAppImportInput = z.input<typeof WhatsAppImportInput>;
export type WhatsAppImportMessage = z.output<typeof WhatsAppImportInput>['messages'][number];

/** One message of the stored object: only what survived the rules. */
export interface StoredChatMessage {
  id: string;
  ts: string;
  sender: string;
  text: string;
  mediaRef?: string;
  /** An audio attachment: kept as a file, never transcribed. */
  voiceNote?: boolean;
}

/** The stored raw object of a `whatsapp_export` capture. */
export interface StoredChat {
  v: 1;
  chatTitleHash: string;
  chatType: 'internal' | 'client';
  dateOrder: DateOrder;
  messages: StoredChatMessage[];
}

/** Export-format text for `messages`, one `dd/mm/yyyy, HH:mm - Sender: text` line each. */
export function rebuildExportText(
  messages: readonly Pick<WhatsAppImportMessage, 'ts' | 'sender' | 'text' | 'mediaRef'>[],
  dateOrder: DateOrder,
): string {
  return messages
    .map((m) => {
      const [date = '', time = ''] = m.ts.split('T');
      const [year = '', month = '', day = ''] = date.split('-');
      const [a, b] = dateOrder === 'dmy' ? [day, month] : [month, day];
      const sender = m.sender.replace(/[:\r\n]+/g, ' ').trim();
      const body =
        m.text.trim() === '' && m.mediaRef !== undefined ? `${m.mediaRef} (file attached)` : m.text;
      return `${a}/${b}/${year}, ${time.slice(0, 5)} - ${sender}: ${body}`;
    })
    .join('\n');
}

const ALLOWED_EXTENSIONS = new Set(
  ALLOWED_TYPES.filter((t) => t.allowMarkup !== true).flatMap((t) => t.extensions),
);

/** The file name when it is a plain name with an allow-listed extension, else `null`. */
export function safeMediaName(name: string): string | null {
  if (name.includes('/') || name.includes('\\')) return null;
  for (let i = 0; i < name.length; i += 1) if (name.charCodeAt(i) < 0x20) return null;
  const extension = name.split('.').at(-1)?.toLowerCase();
  return extension !== undefined && name.includes('.') && ALLOWED_EXTENSIONS.has(extension)
    ? name
    : null;
}

export function mediaKindOf(name: string): MediaKind {
  return mediaKindFromName(name);
}
