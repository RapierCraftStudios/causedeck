// WhatsApp chat structuring, the pure half (#526): what goes to the `structure_chat` task and what
// is believed of what comes back. Only an internal chat is ever structured; every returned item
// must cite a selected message, quote it verbatim and carry a date that is literally in its text,
// or it is dropped. The model's own ts/sender are replaced by the cited message's.
import type { DateOrder } from './types.ts';

export interface ChatMessage {
  id: string;
  ts: string;
  sender: string | null;
  text: string;
}

export interface StructureInput {
  chatType: 'internal';
  messages: { ref: string; ts: string; sender: string; text: string }[];
}

/** Raised for a chat that must not reach the model. */
export class ClientChatNotStructurableError extends Error {
  override name = 'ClientChatNotStructurableError';

  constructor() {
    super('client chats are never sent to the structuring task');
  }
}

/** The task input for `messages`; throws for a `client` chat. System lines are left out. */
export function buildStructureInput(
  chatType: 'internal' | 'client',
  messages: readonly ChatMessage[],
): StructureInput {
  if (chatType !== 'internal') throw new ClientChatNotStructurableError();
  return {
    chatType,
    messages: messages.flatMap((m) =>
      m.sender === null || m.text.trim() === ''
        ? []
        : [{ ref: m.id, ts: m.ts, sender: m.sender, text: m.text }],
    ),
  };
}

export interface RawChatItem {
  title: string;
  dueDate: string | null;
  ref: string;
  quote: string;
  clientInstruction: boolean;
  confidence: number;
}

export interface VerifiedChatItem extends RawChatItem {
  /** From the cited message, not from the model. */
  ts: string;
  sender: string;
}

const MONTHS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sept', 'sep'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
] as const;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether the calendar day `iso` (`YYYY-MM-DD`) is written out in `text`, in a numeric or named form. */
export function dateAppearsInText(
  iso: string,
  text: string,
  dateOrder: DateOrder = 'dmy',
): boolean {
  const m = ISO.exec(iso);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const yearOk = (y: number): boolean => y === year || (y < 100 && 2000 + y === year);

  const numeric = /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?!\d)/g;
  for (const hit of text.matchAll(numeric)) {
    const a = Number(hit[1]);
    const b = Number(hit[2]);
    const [d, mo] = dateOrder === 'dmy' ? [a, b] : [b, a];
    if (d === day && mo === month && yearOk(Number(hit[3]))) return true;
  }
  const names = (MONTHS[month - 1] ?? []).join('|');
  if (names === '') return false;
  const named = [
    new RegExp(`(?<!\\d)0?${String(day)}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${names})\\.?,?\\s+(\\d{2,4})(?!\\d)`, 'i'),
    new RegExp(`\\b(?:${names})\\.?\\s+0?${String(day)}(?:st|nd|rd|th)?,?\\s+(\\d{2,4})(?!\\d)`, 'i'),
  ];
  return named.some((re) => {
    const hit = re.exec(text);
    return hit?.[1] !== undefined && yearOk(Number(hit[1]));
  });
}

export interface VerifyOptions {
  dateOrder?: DateOrder;
}

/** Keeps the items that are anchored to a selected message and say nothing the message does not. */
export function verifyChatItems(
  items: readonly RawChatItem[],
  messages: readonly ChatMessage[],
  options: VerifyOptions = {},
): VerifiedChatItem[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const kept: VerifiedChatItem[] = [];
  for (const item of items) {
    const source = byId.get(item.ref);
    if (source?.sender == null) continue;
    const quote = item.quote.trim();
    if (quote === '' || !source.text.includes(quote)) continue;
    if (item.dueDate !== null && !dateAppearsInText(item.dueDate, source.text, options.dateOrder)) {
      continue;
    }
    kept.push({ ...item, quote, ts: source.ts, sender: source.sender });
  }
  return kept;
}
