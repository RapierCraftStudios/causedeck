// WhatsApp "Export chat" text parser (#525). Android (`12/10/2026, 10:01 - Name: text`) and iOS
// (`[12/10/26, 10:01:05 PM] Name: text`) layouts, 12/24-hour clocks, narrow no-break spaces,
// multi-line messages, system lines and edited/deleted/null/attachment markers. Pure string work.
import { detectDateOrder } from './date-order.ts';
import { detectAttachment } from './media-names.ts';
import type { DateOrder, ParsedExport, ParsedMessage } from './types.ts';

const DATE = String.raw`(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})`;
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?: ?([AaPp])\.?[Mm]\.?)?`;
const ANDROID = new RegExp(String.raw`^${DATE},? ${TIME} - (.*)$`);
const IOS = new RegExp(String.raw`^\[${DATE},? ${TIME}\] (.*)$`);

const SYSTEM_SENDER =
  /\b(?:created group|added|removed|left|changed|joined|security code|end-to-end|encrypted|pinned|turned|deleted group)\b/i;

interface Header {
  a: number;
  b: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  meridiem: string | undefined;
  rest: string;
}

function parseHeader(line: string): Header | null {
  const m = ANDROID.exec(line) ?? IOS.exec(line);
  if (m === null) return null;
  const n = (i: number): number => Number(m[i]);
  const year = n(3);
  return {
    a: n(1),
    b: n(2),
    year: year < 100 ? 2000 + year : year,
    hour: n(4),
    minute: n(5),
    second: m[6] === undefined ? 0 : n(6),
    meridiem: m[7]?.toLowerCase(),
    rest: m[8] ?? '',
  };
}

const pad = (v: number): string => String(v).padStart(2, '0');

function timestamp(h: Header, order: DateOrder): string | null {
  const day = order === 'dmy' ? h.a : h.b;
  const month = order === 'dmy' ? h.b : h.a;
  let hour = h.hour;
  if (h.meridiem !== undefined) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (h.meridiem === 'p' ? 12 : 0);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || h.minute > 59) return null;
  if (h.second > 59) return null;
  const daysInMonth = new Date(Date.UTC(h.year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${String(h.year)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(h.minute)}:${pad(h.second)}`;
}

/** Strips direction marks and BOM, and turns narrow/no-break spaces into plain spaces. */
export function normalizeExport(text: string): string {
  return text.replace(/[\u200E\u200F\u202A-\u202E\uFEFF]/g, '').replace(/[\u202F\u00A0]/g, ' ');
}

const EDITED = /\s*<This message was edited>\s*$/i;
const DELETED = /^(?:This message was deleted|You deleted this message)\.?$/i;

function buildMessage(index: number, at: string | null, rest: string): ParsedMessage {
  const sep = rest.indexOf(': ');
  const senderPart = sep === -1 ? null : rest.slice(0, sep);
  const system = senderPart === null || SYSTEM_SENDER.test(senderPart);
  const sender = system ? null : senderPart;
  const text = system ? rest : rest.slice(sep + 2);
  return { index, at, sender, system, text, edited: false, deleted: false, attachment: null };
}

function classify(message: ParsedMessage): ParsedMessage {
  if (message.system) return message;
  let text = message.text;
  let edited = false;
  if (EDITED.test(text)) {
    edited = true;
    text = text.replace(EDITED, '');
  }
  const trimmed = text.trim();
  if (trimmed === 'null' || DELETED.test(trimmed)) {
    return { ...message, text: '', edited, deleted: true };
  }
  const attachment = detectAttachment(trimmed);
  return { ...message, text, edited, attachment };
}

/**
 * Parses an exported chat. `dateOrder` forces the field order (the flip); without it the order is
 * detected from the dates and defaults to dd/mm.
 */
export function parseWhatsAppExport(
  input: string,
  options: { dateOrder?: DateOrder } = {},
): ParsedExport {
  const lines = normalizeExport(input).split(/\r\n|\n|\r/);
  const headers = lines.map(parseHeader);
  const detection = detectDateOrder(
    headers.flatMap((h) => (h === null ? [] : [[h.a, h.b] as const])),
  );
  const order = options.dateOrder ?? detection.order;
  const ambiguous = options.dateOrder === undefined && detection.ambiguous;

  const raw: ParsedMessage[] = [];
  let skippedLines = 0;
  lines.forEach((line, i) => {
    const header = headers[i];
    if (header !== undefined && header !== null) {
      raw.push(buildMessage(raw.length, timestamp(header, order), header.rest));
      return;
    }
    const last = raw[raw.length - 1];
    if (last === undefined) {
      if (line.trim() !== '') skippedLines += 1;
      return;
    }
    last.text += `\n${line}`;
  });

  const messages = raw.map((m) => classify({ ...m, text: m.text.replace(/\s+$/, '') }));
  return { messages, dateOrder: order, dateOrderAmbiguous: ambiguous, skippedLines };
}
