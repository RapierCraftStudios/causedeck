// Verified diary entries -> automation drafts (#52). Nothing is attached to a matter without an
// identifier match: a case reference must normalise to exactly one proceeding's number and year.
// The engine's matrix decides each level: `next_date` and `new_matter` are always proposals (L2), a
// dated task is a proposal and an undated one reaches L3 only at confidence >= 0.8. A hearing
// outcome note is a `task` draft (there is no note kind) whose confidence is capped under 0.8, so
// it stays a proposal (L2): handwriting never earns an unasked write.
import type { ProposalDraft } from '@causedeck/validators';

import { asciiDigits } from './dates.ts';
import { anchorKey } from './line-anchors.ts';
import type { DiaryAnchor, DiaryEntry, DiaryStructured } from './schema.ts';

/** The least a hearing note's confidence is capped to, keeping it under the L3 gate of a task. */
export const NOTE_CONFIDENCE_CAP = 0.79;
const DEFAULT_CONFIDENCE = 0.6;

export interface DiaryProceeding {
  proceedingId: string;
  matterId: string;
  /** Normalised: no leading zeros. */
  number: string;
  year: number;
}

export interface DiaryDraftContext {
  captureId: string;
  /** The `ai_call` behind the entries. */
  aiCallId: string | null;
  /** The workspace's proceedings a case reference may match. */
  proceedings: readonly DiaryProceeding[];
  /** Stored `anchor.id` by `anchorKey`; an entry whose anchor is missing yields an unanchored draft. */
  anchorIds?: ReadonlyMap<string, string>;
}

export interface CaseRef {
  number: string;
  year: number;
}

const CASE_REF = /(\d{1,7})\s*(?:\/|\bof\b|-)\s*(\d{4}|\d{2})(?!\d)/i;

/** The number and year of a case reference (`WP 123/2026`, `No. 0123 of 26`), or null. */
export function normaliseCaseRef(raw: string): CaseRef | null {
  const m = CASE_REF.exec(asciiDigits(raw));
  if (m === null) return null;
  const rawYear = m[2] ?? '';
  const value = Number.parseInt(rawYear, 10);
  const year = rawYear.length === 2 ? (value <= 50 ? 2000 + value : 1900 + value) : value;
  if (year < 1900 || year > 2099) return null;
  return { number: (m[1] ?? '').replace(/^0+(?=\d)/, ''), year };
}

export type CaseMatch =
  | { kind: 'matched'; proceeding: DiaryProceeding }
  | { kind: 'ambiguous' }
  | { kind: 'unmatched' }
  | { kind: 'none' };

export function matchCaseRef(
  caseRef: string | undefined,
  proceedings: readonly DiaryProceeding[],
): CaseMatch {
  if (caseRef === undefined) return { kind: 'none' };
  const ref = normaliseCaseRef(caseRef);
  if (ref === null) return { kind: 'none' };
  const hits = proceedings.filter((p) => p.number === ref.number && p.year === ref.year);
  if (hits.length === 1 && hits[0] !== undefined) return { kind: 'matched', proceeding: hits[0] };
  return hits.length > 1 ? { kind: 'ambiguous' } : { kind: 'unmatched' };
}

/** Words of the lawyer's own writing left once the case reference is taken out of the entry. */
function ownWords(entry: DiaryEntry): number {
  const rest = entry.caseRef === undefined ? entry.text : entry.text.replace(entry.caseRef, ' ');
  return rest.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function anchorIdsOf(
  anchors: readonly DiaryAnchor[],
  ids: ReadonlyMap<string, string> | undefined,
): string[] {
  const out = new Set<string>();
  for (const anchor of anchors) {
    const id = ids?.get(anchorKey(anchor));
    if (id !== undefined) out.add(id);
  }
  return [...out];
}

export function diaryToProposalDrafts(
  structured: DiaryStructured,
  ctx: DiaryDraftContext,
): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const newMatters = new Set<string>();
  structured.entries.forEach((entry, index) => {
    const confidence = entry.confidence ?? DEFAULT_CONFIDENCE;
    const match = matchCaseRef(entry.caseRef, ctx.proceedings);
    const anchors = anchorIdsOf(
      [entry.anchor, ...(entry.nextDate === undefined ? [] : [entry.nextDate.anchor])],
      ctx.anchorIds,
    );
    const base = {
      captureId: ctx.captureId,
      source: {
        type: 'ai' as const,
        input: 'document',
        aiCallId: ctx.aiCallId,
        ref: `page-${String(entry.anchor.page)}-entry-${String(index + 1)}`,
      },
      anchors,
    };

    if (match.kind === 'matched') {
      const { proceeding } = match;
      const link = {
        matterId: proceeding.matterId,
        proceedingId: proceeding.proceedingId,
        match: { score: 1, exact: 'case_number' as const },
      };
      if (entry.nextDate !== undefined && entry.kind === 'hearing_note') {
        drafts.push({
          ...base,
          ...link,
          kind: 'next_date',
          payload: { proceedingId: proceeding.proceedingId, date: entry.nextDate.date },
          confidence,
          patternKey: 'diary:next_date',
        });
      } else if (entry.kind === 'task' || entry.kind === 'reminder') {
        drafts.push({
          ...base,
          ...link,
          kind: 'task',
          payload: {
            title: entry.text,
            matterId: proceeding.matterId,
            proceedingId: proceeding.proceedingId,
            ...(entry.nextDate === undefined ? {} : { dueDate: entry.nextDate.date }),
          },
          confidence,
          patternKey: 'diary:task',
        });
      }
      if (entry.kind === 'hearing_note') {
        drafts.push({
          ...base,
          ...link,
          kind: 'task',
          payload: {
            title: entry.text,
            matterId: proceeding.matterId,
            proceedingId: proceeding.proceedingId,
          },
          confidence: Math.min(confidence, NOTE_CONFIDENCE_CAP),
          patternKey: 'diary:hearing_note',
        });
      }
      return;
    }

    if (match.kind === 'ambiguous') {
      // Two proceedings share the number and year: a card for the lawyer, attached to neither.
      drafts.push({
        ...base,
        kind: 'task',
        payload: { title: entry.text },
        confidence: Math.min(confidence, NOTE_CONFIDENCE_CAP),
        ambiguous: true,
        patternKey: 'diary:hearing_note',
      });
      return;
    }

    if (match.kind === 'unmatched') {
      const ref = normaliseCaseRef(entry.caseRef ?? '');
      const key = ref === null ? '' : `${ref.number}/${String(ref.year)}`;
      if (entry.kind !== 'unknown' && ownWords(entry) >= 2 && !newMatters.has(key)) {
        newMatters.add(key);
        drafts.push({
          ...base,
          kind: 'new_matter',
          payload: { title: (entry.caseRef ?? '').trim(), synopsis: entry.text },
          confidence: Math.min(confidence, NOTE_CONFIDENCE_CAP),
          patternKey: 'diary:new_matter',
        });
      }
      return;
    }

    // No case reference: only an explicit task or reminder becomes a draft, with no matter.
    if (entry.kind === 'task' || entry.kind === 'reminder') {
      drafts.push({
        ...base,
        kind: 'task',
        payload: {
          title: entry.text,
          ...(entry.nextDate === undefined ? {} : { dueDate: entry.nextDate.date }),
        },
        confidence,
        patternKey: 'diary:task',
      });
    }
  });
  return drafts;
}
