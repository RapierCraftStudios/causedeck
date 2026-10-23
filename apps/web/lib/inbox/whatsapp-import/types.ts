// Shapes shared by the WhatsApp import worker and the flow (#527). Client-safe: no server imports.
import type { DateOrder, ExclusionRule } from '@causedeck/capture/whatsapp';

/** One importable message of the export, with the exclusion rules it trips. */
export interface ImportRow {
  /** The parser's message index, as a string: the id the server payload uses. */
  id: string;
  /** Local wall-clock `YYYY-MM-DDTHH:mm:ss`. */
  ts: string;
  sender: string;
  text: string;
  /** The attachment's file name, when the export names one. */
  mediaRef?: string;
  rules: ExclusionRule[];
}

export type ParseFailure = 'not_zip' | 'no_chat' | 'too_large' | 'empty' | 'failed';

export interface ParsedChat {
  /** The chat title, read from the file name; it never leaves the browser, only its hash does. */
  title: string;
  titleHash: string;
  dateOrder: DateOrder;
  dateOrderAmbiguous: boolean;
  senders: string[];
  rows: ImportRow[];
}

export type WorkerRequest = { type: 'parse'; file: File; dateOrder?: DateOrder };

export type WorkerResponse =
  | { type: 'progress'; stage: 'read' | 'unzip' | 'parse'; fraction: number }
  | { type: 'done'; chat: ParsedChat }
  | { type: 'error'; reason: ParseFailure };
