// Server-side check of an import selection (#525). The browser parses and filters for the user's
// benefit; the server trusts none of it: it re-parses the uploaded text, re-applies the exclusion
// rules and enforces the limits (capture is the trust boundary, ADR 0021).
import { sizeCapBytes } from '../allow-list.ts';

import { applyExclusions, type ExcludedMessage, type ExclusionOptions } from './exclusions.ts';
import { parseWhatsAppExport } from './parser.ts';
import type { ChatKind, DateOrder, ParsedMessage } from './types.ts';

/** Most messages one import may select. */
export const MAX_SELECTED_MESSAGES = 5000;

export type SelectionErrorCode =
  | 'chat_type_mismatch'
  | 'too_large'
  | 'too_many_messages'
  | 'not_a_chat_export'
  | 'empty_selection'
  | 'invalid_selection';

export class WhatsAppSelectionError extends Error {
  override name = 'WhatsAppSelectionError';

  constructor(
    readonly code: SelectionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isWhatsAppSelectionError(error: unknown): error is WhatsAppSelectionError {
  return error instanceof WhatsAppSelectionError;
}

export interface ValidateSelectionInput extends ExclusionOptions {
  /** The raw uploaded export text. */
  text: string;
  /** The chat type the client declared for this upload. */
  chatType: ChatKind;
  /** The chat type the import was opened for. */
  expectedChatType: ChatKind;
  /** Indexes (from `parseWhatsAppExport`) the user selected. */
  selectedIndexes: readonly number[];
  /** Indexes the user confirmed despite an overridable match. */
  confirmedIndexes?: readonly number[] | undefined;
  dateOrder?: DateOrder | undefined;
  /** Per-name size cap overrides, as in `CaptureConfig.sizeCapsBytes`. */
  sizeCapsBytes?: Readonly<Record<string, number>> | undefined;
}

export interface ValidatedSelection {
  /** Selected messages that passed every rule, in export order. */
  messages: ParsedMessage[];
  /** Selected messages the rules held back. */
  excluded: ExcludedMessage[];
  dateOrder: DateOrder;
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** Throws `WhatsAppSelectionError` on a bad selection; otherwise returns what may be imported. */
export function validateSelection(input: ValidateSelectionInput): ValidatedSelection {
  if (input.chatType !== input.expectedChatType) {
    throw new WhatsAppSelectionError(
      'chat_type_mismatch',
      `this import is for ${input.expectedChatType} chats, not ${input.chatType}`,
    );
  }
  const cap = sizeCapBytes({ name: 'txt' }, input.sizeCapsBytes);
  if (utf8Length(input.text) > cap) {
    throw new WhatsAppSelectionError(
      'too_large',
      `chat exports are limited to ${String(cap)} bytes`,
    );
  }
  if (input.selectedIndexes.length > MAX_SELECTED_MESSAGES) {
    throw new WhatsAppSelectionError(
      'too_many_messages',
      `an import is limited to ${String(MAX_SELECTED_MESSAGES)} messages`,
    );
  }
  if (input.selectedIndexes.length === 0) {
    throw new WhatsAppSelectionError('empty_selection', 'select at least one message');
  }
  const parsed = parseWhatsAppExport(
    input.text,
    input.dateOrder === undefined ? {} : { dateOrder: input.dateOrder },
  );
  if (parsed.messages.length === 0) {
    throw new WhatsAppSelectionError(
      'not_a_chat_export',
      'this file is not a WhatsApp chat export',
    );
  }
  const chosen = new Set<number>();
  for (const i of input.selectedIndexes) {
    if (!Number.isInteger(i) || i < 0 || i >= parsed.messages.length) {
      throw new WhatsAppSelectionError(
        'invalid_selection',
        'the selection names a message that is not in the export',
      );
    }
    chosen.add(i);
  }
  const selected = parsed.messages.filter((m) => chosen.has(m.index));
  const { kept, excluded } = applyExclusions(
    selected,
    input,
    new Set(input.confirmedIndexes ?? []),
  );
  return { messages: kept, excluded, dateOrder: parsed.dateOrder };
}
