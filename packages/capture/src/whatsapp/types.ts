// WhatsApp export types (#525, part 1 of #55). Isomorphic: no Node APIs, so the browser Web Worker
// (#527) and the server (`validateSelection`) run the same parser and rules.

/** The kind of chat an import was opened for. Internal chats are the default (#55). */
export type ChatKind = 'internal' | 'client';

export const CHAT_KINDS: readonly ChatKind[] = ['internal', 'client'];

/** `dmy` is the default; `mdy` is the flip. */
export type DateOrder = 'dmy' | 'mdy';

export type MediaKind = 'image' | 'video' | 'audio' | 'sticker' | 'document' | 'contact' | 'other';

export interface Attachment {
  /** The exported file name, or `null` when the export only says "<Media omitted>". */
  name: string | null;
  kind: MediaKind;
}

export interface ParsedMessage {
  /** Zero-based position in the export; the stable id a selection refers to. */
  index: number;
  /** Local wall-clock `YYYY-MM-DDTHH:mm:ss` (an export carries no zone), or `null` if unreadable. */
  at: string | null;
  /** `null` for system lines. */
  sender: string | null;
  system: boolean;
  text: string;
  edited: boolean;
  /** Deleted, or exported as the literal `null`. */
  deleted: boolean;
  attachment: Attachment | null;
}

export interface ParsedExport {
  messages: ParsedMessage[];
  dateOrder: DateOrder;
  /** The dates fit both orders or conflict, so `dateOrder` is a guess the UI should offer to flip. */
  dateOrderAmbiguous: boolean;
  /** Lines before the first message header that belong to no message. */
  skippedLines: number;
}
