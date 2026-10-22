// Case-number matching for calendar events (#53): finds `W.P. 12345/2026`, `CRL OP 7 of 25` and the
// like in an event's text and normalises them with the adapter normalisers, so the importer can
// look the proceeding up inside the workspace by case type, number and year. Pure, no database.
import { parseCaseReference } from '@causedeck/adapters';

import type { IcsEvent } from './parse.ts';

export interface CaseCandidate {
  /** The normalised case type code when one precedes the number (`WP`), else null. */
  caseType: string | null;
  number: string;
  year: number;
}

const NUMBER_AT = /\b(\d{1,7})\s*(?:\/|\bof\b)\s*(\d{4}|\d{2})\b/gi;
/** How much text before the number may hold the case type (`W.P.(MD) No.`). */
const TYPE_WINDOW = 28;
/** A token that can be part of a case type: `WP`, `W.P.`, `W.P.(MD)`, `Crl.O.P.`, `CRL`. */
const TYPE_TOKEN =
  /^(?:(?:[A-Z]\.){1,4}[A-Za-z]*\.?|[A-Z]{1,6}\.?|(?:Crl|Arb|Cont|Rev|Tr)\.?[A-Za-z.]*)(?:\([A-Za-z.]+\))?$/;
const TYPE_MAX_TOKENS = 2;

/** The case type printed just before the number (`HC listing - WP 4521/26` gives `WP`), if any. */
function typeBefore(head: string): string | null {
  const tokens = head
    .replace(/\bno\.?\s*$/i, '')
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  const run: string[] = [];
  for (const token of tokens.reverse()) {
    if (run.length >= TYPE_MAX_TOKENS || !TYPE_TOKEN.test(token)) break;
    run.unshift(token);
  }
  return run.length === 0
    ? null
    : (parseCaseReference(`${run.join(' ')} 1/2000`)?.caseType ?? null);
}

/** The distinct case numbers named in `text`, in order of appearance. */
export function caseCandidatesIn(text: string): CaseCandidate[] {
  const out: CaseCandidate[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(NUMBER_AT)) {
    const start = match.index;
    const ref = parseCaseReference(match[0]);
    if (ref === null) continue;
    const caseType = typeBefore(text.slice(Math.max(0, start - TYPE_WINDOW), start));
    const key = `${caseType ?? ''}/${ref.number}/${String(ref.year)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ caseType, number: ref.number, year: ref.year });
  }
  return out;
}

/** The case numbers in an event's summary, location and description (summary first). */
export function caseCandidatesOf(event: Pick<IcsEvent, 'summary' | 'location' | 'description'>) {
  return caseCandidatesIn(`${event.summary}\n${event.location}\n${event.description}`);
}
