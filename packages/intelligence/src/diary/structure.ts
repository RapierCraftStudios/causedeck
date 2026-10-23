// `structureDiaryPage` (#52): photographed diary pages -> anchored entries. The conservative
// contract of docs/product/09 §3/§4.4/§5/§8: nothing reaches the gateway for a sensitive matter;
// a page that reads poorly is `unreadable` (never guessed at); every entry must cite a numbered
// OCR line (its anchor is that line's box and text); a date survives only when it literally
// appears in the line it cites (`datePresence`), else the entry stays as a note without a date.
import type { AiGateway, RunContext } from '@causedeck/ai';

import { datePresence } from './dates.ts';
import { anchorOf, numberLines, type DiaryPage, type NumberedLine } from './line-anchors.ts';
import { DiaryStructuredSchema, type DiaryEntry, type DiaryStructured } from './schema.ts';

/** The copy a page that could not be read shows (also in `camera.json`). */
export const DIARY_UNREADABLE_COPY =
  "Couldn't read this. Retake, type the key line, or keep as an attachment.";

/** Mean OCR line confidence under which a page is not structured. */
export const DEFAULT_DIARY_READ_FLOOR = 0.5;

export interface RawDiaryEntry {
  dateText?: string | null | undefined;
  caseRef?: string | null | undefined;
  text: string;
  nextDate?: { date: string; phrase: string; line: number } | null | undefined;
  kind: DiaryEntry['kind'];
  line: number;
  confidence?: number | undefined;
}

export interface StructureDiaryDeps {
  gateway: AiGateway;
  scope: Pick<RunContext, 'workspaceId' | 'captureId' | 'matterId' | 'userId'>;
  pipelineVersion: string;
}

export interface StructureDiaryInput {
  pages: readonly DiaryPage[];
  /** The capture is `ai_blocked` (a sensitive matter hint): no gateway call, ever. */
  aiBlocked: boolean;
  /** Pages whose mean line confidence is under this are `unreadable`. */
  readFloor?: number;
}

export type StructureDiaryOutcome =
  /** Sensitive matter: kept as an attachment at L1; the gateway was not called. */
  | { status: 'skipped'; reason: 'sensitive_matter' }
  | { status: 'unreadable'; reason: 'no_lines' | 'low_confidence'; copy: string }
  | {
      status: 'ok';
      result: DiaryStructured;
      /** The `ai_call` behind the entries. */
      aiCallId: string;
      /** Entries dropped for citing no real line. */
      rejected: number;
      /** Dates dropped because they are not written in the line they cite. */
      datesRejected: number;
    };

const normaliseSpace = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Resolve the model's entries against the numbered lines. Pure: the checks that make the output safe.
 */
export function verifyDiaryEntries(
  raw: readonly RawDiaryEntry[],
  lines: readonly NumberedLine[],
): { entries: DiaryEntry[]; rejected: number; datesRejected: number } {
  const byN = new Map(lines.map((line) => [line.n, line]));
  const entries: DiaryEntry[] = [];
  let rejected = 0;
  let datesRejected = 0;
  for (const item of raw) {
    const line = byN.get(item.line);
    const text = item.text.trim();
    if (line === undefined || text === '') {
      rejected += 1;
      continue;
    }
    const entry: DiaryEntry = { text, kind: item.kind, anchor: anchorOf(line) };
    if (item.confidence !== undefined) entry.confidence = item.confidence;
    const caseRef = item.caseRef?.trim();
    if (caseRef) entry.caseRef = caseRef;
    const dateText = item.dateText?.trim();
    if (dateText && normaliseSpace(line.text).includes(normaliseSpace(dateText))) {
      entry.dateText = dateText;
    }
    if (item.nextDate != null) {
      const dateLine = byN.get(item.nextDate.line);
      const phrase = item.nextDate.phrase.trim();
      const written =
        dateLine !== undefined &&
        phrase !== '' &&
        normaliseSpace(dateLine.text).includes(normaliseSpace(phrase)) &&
        datePresence(item.nextDate.date, phrase);
      if (written) {
        entry.nextDate = { date: item.nextDate.date, phrase, anchor: anchorOf(dateLine) };
      } else {
        datesRejected += 1;
      }
    }
    entries.push(entry);
  }
  return { entries, rejected, datesRejected };
}

export async function structureDiaryPage(
  deps: StructureDiaryDeps,
  input: StructureDiaryInput,
): Promise<StructureDiaryOutcome> {
  if (input.aiBlocked) return { status: 'skipped', reason: 'sensitive_matter' };
  const lines = numberLines(input.pages);
  if (lines.length === 0) {
    return { status: 'unreadable', reason: 'no_lines', copy: DIARY_UNREADABLE_COPY };
  }
  const mean = lines.reduce((sum, line) => sum + line.conf, 0) / lines.length;
  if (mean < (input.readFloor ?? DEFAULT_DIARY_READ_FLOOR)) {
    return { status: 'unreadable', reason: 'low_confidence', copy: DIARY_UNREADABLE_COPY };
  }
  const result = await deps.gateway.run<{ entries: RawDiaryEntry[]; confidence: number }>(
    'structure_diary',
    {
      text: lines.map((line) => line.text).join('\n'),
      lines: lines.map(({ n, page, text }) => ({ n, page, text })),
    },
    {
      ...deps.scope,
      purpose: 'capture.structure_diary',
      automationLevel: 2,
      idempotencyKey: `capture-diary:${deps.scope.captureId ?? 'none'}:${deps.pipelineVersion}`,
    },
  );
  const verified = verifyDiaryEntries(result.output.entries, lines);
  return {
    status: 'ok',
    result: DiaryStructuredSchema.parse({ entries: verified.entries }),
    aiCallId: result.callId,
    rejected: verified.rejected,
    datesRejected: verified.datesRejected,
  };
}
