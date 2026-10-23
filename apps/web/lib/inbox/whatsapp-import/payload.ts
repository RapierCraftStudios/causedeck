// The upload body of `POST /api/captures/whatsapp` (#526, #527): the selected messages only.
// Unselected and excluded text, the chat title and the zip never enter this object. Client-safe.
import { NON_OVERRIDABLE_RULES, type DateOrder } from '@causedeck/capture/whatsapp';

import type { ImportRow, ParsedChat } from './types.ts';

/** The most messages one import may carry (`MAX_SELECTED_MESSAGES` in `@causedeck/capture`). */
export const MAX_IMPORT_MESSAGES = 5000;

export interface WhatsAppUploadPayload {
  workspaceId: string;
  chatTitleHash: string;
  chatType: 'internal';
  openedFor: 'internal';
  dateOrder: DateOrder;
  messages: { id: string; ts: string; sender: string; text: string; mediaRef?: string }[];
  confirmedIds?: string[];
}

export const isReleasable = (row: ImportRow): boolean =>
  row.rules.every((rule) => !NON_OVERRIDABLE_RULES.includes(rule));

/** A row that trips a rule is sent only when the user confirmed it and the rules allow release. */
export function buildPayload(
  workspaceId: string,
  chat: Pick<ParsedChat, 'titleHash' | 'dateOrder' | 'rows'>,
  selected: ReadonlySet<string>,
  confirmed: ReadonlySet<string>,
): WhatsAppUploadPayload {
  const messages: WhatsAppUploadPayload['messages'] = [];
  const confirmedIds: string[] = [];
  for (const row of chat.rows) {
    if (!selected.has(row.id)) continue;
    if (row.rules.length > 0) {
      if (!confirmed.has(row.id) || !isReleasable(row)) continue;
      confirmedIds.push(row.id);
    }
    messages.push({
      id: row.id,
      ts: row.ts,
      sender: row.sender,
      text: row.text,
      ...(row.mediaRef === undefined ? {} : { mediaRef: row.mediaRef }),
    });
  }
  return {
    workspaceId,
    chatTitleHash: chat.titleHash,
    chatType: 'internal',
    openedFor: 'internal',
    dateOrder: chat.dateOrder,
    messages,
    ...(confirmedIds.length === 0 ? {} : { confirmedIds }),
  };
}
