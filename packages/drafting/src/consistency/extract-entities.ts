// Mentions in a draft's block text, with their spans: names, case numbers, dates and annexure
// references. Pure and deterministic; nothing here reads the graph or logs text. A span is the block
// key (as `walkBlocks` keys it) and a character range in that block's text.
import type { Block } from '@causedeck/validators/drafting';

import { walkBlocks } from '../blocks';

import { findCaseNumbers, type CaseNumberHit } from './match-case-numbers';
import { findDates, type DateHit } from './match-dates';
import { findNameMentions, type NameHit } from './match-names';

export interface Located {
  blockKey: string;
  start: number;
  end: number;
  raw: string;
}

export interface TextBlock {
  key: string;
  text: string;
}

export type NameMention = Located & Omit<NameHit, 'start' | 'end' | 'raw'>;
export type CaseNumberMention = Located & Omit<CaseNumberHit, 'start' | 'end' | 'raw'>;
export type DateMention = Located & Omit<DateHit, 'start' | 'end' | 'raw'>;
export interface AnnexureMention extends Located {
  n: number;
  /** An index line such as `Annexure P-1 - Copy of the order`, which defines the number. */
  definition: boolean;
}

export interface Entities {
  names: NameMention[];
  caseNumbers: CaseNumberMention[];
  dates: DateMention[];
  annexures: AnnexureMention[];
}

/** The text of every block that carries some, in document order. */
export function collectText(blocks: readonly Block[]): TextBlock[] {
  const out: TextBlock[] = [];
  walkBlocks(blocks, ({ block, key }) => {
    const text =
      block.type === 'heading' || block.type === 'paragraph'
        ? block.text
        : block.type === 'section'
          ? (block.title ?? '')
          : '';
    if (text.trim() !== '') out.push({ key, text });
  });
  return out;
}

const ANNEXURE_REF = /\bAnnexures?[ \t]*[-–:.]?[ \t]*P[ \t]*[-–./]?[ \t]*(\d{1,3})(?!\d)/gi;
const DEFINITION_TAIL = /^[ \t]*[-–—:][ \t]*\S/;

export function extractAnnexureRefs(tb: TextBlock): AnnexureMention[] {
  const out: AnnexureMention[] = [];
  for (const m of tb.text.matchAll(ANNEXURE_REF)) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({
      blockKey: tb.key,
      start,
      end,
      raw: m[0],
      n: Number(m[1]),
      definition:
        tb.text.slice(0, start).trim() === '' && DEFINITION_TAIL.test(tb.text.slice(end)),
    });
  }
  return out;
}

export function extractEntities(blocks: readonly Block[]): Entities {
  const entities: Entities = { names: [], caseNumbers: [], dates: [], annexures: [] };
  for (const tb of collectText(blocks)) {
    for (const h of findNameMentions(tb.text)) entities.names.push({ ...h, blockKey: tb.key });
    for (const h of findCaseNumbers(tb.text)) entities.caseNumbers.push({ ...h, blockKey: tb.key });
    for (const h of findDates(tb.text)) entities.dates.push({ ...h, blockKey: tb.key });
    entities.annexures.push(...extractAnnexureRefs(tb));
  }
  return entities;
}
