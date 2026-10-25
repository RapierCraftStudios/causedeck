// English fact blocks (#735): the lines of a draft are built here from graph facts, per audience
// and tone. No line gives advice or a prediction; an unconfirmed fact says so.
import type { Audience, Tone } from '@causedeck/validators/outward-draft';

export interface FactTemplate {
  /** The opening line; empty when the tone has none. */
  opening(audience: Audience, tone: Tone): string;
  closing(audience: Audience, tone: Tone): string;
  /** A calendar date as people say it in this language. */
  date(iso: string): string;
  nextDate(iso: string, confirmed: boolean): string;
  outcome(text: string, confirmed: boolean): string;
  order(orderType: string, iso: string, confirmed: boolean): string;
  obligation(description: string, dueIso: string | null, confirmed: boolean): string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2026-12-12` -> day and zero-based month and year, read from the text (no time zone). */
export function dateParts(iso: string): { day: number; month: number; year: number } {
  const [y, m, d] = iso.split('-');
  return { day: Number(d), month: Number(m) - 1, year: Number(y) };
}

const TBC = ' (to be confirmed)';
const tbc = (confirmed: boolean) => (confirmed ? '' : TBC);

const OPENING: Record<Audience, Record<Tone, string>> = {
  client: {
    formal: 'Dear Sir or Madam, this is an update on your matter.',
    brief: 'Update on your matter:',
    warm: 'Hello, here is where your matter stands.',
  },
  senior_counsel: {
    formal: 'Dear Sir or Madam, this is an update on the matter.',
    brief: 'Update:',
    warm: 'Hello, a quick update on the matter.',
  },
  briefing_counsel: {
    formal: 'Dear Sir or Madam, this is an update for your briefing.',
    brief: 'Briefing update:',
    warm: 'Hello, a quick update for your briefing.',
  },
};

const CLOSING: Record<Tone, string> = {
  formal: 'Please let me know if you would like any further detail.',
  brief: '',
  warm: 'Do get in touch if anything is unclear.',
};

export const en: FactTemplate = {
  opening: (audience, tone) => OPENING[audience][tone],
  closing: (_audience, tone) => CLOSING[tone],
  date(iso) {
    const { day, month, year } = dateParts(iso);
    return `${day} ${MONTHS[month] ?? ''} ${year}`;
  },
  nextDate(iso, confirmed) {
    return `The next date is ${this.date(iso)}${tbc(confirmed)}.`;
  },
  outcome: (text, confirmed) => `Outcome: ${text.replace(/[.\s]+$/u, '')}${tbc(confirmed)}.`,
  order(orderType, iso, confirmed) {
    return `An ${orderType} order was passed on ${this.date(iso)}${tbc(confirmed)}.`;
  },
  obligation(description, dueIso, confirmed) {
    const due = dueIso === null ? '' : `, due ${this.date(dueIso)}`;
    return `Pending: ${description.replace(/[.\s]+$/u, '')}${due}${tbc(confirmed)}.`;
  },
};
