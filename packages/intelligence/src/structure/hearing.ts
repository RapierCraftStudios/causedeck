// `structureHearing` (#541): gateway task `structure_hearing` over a transcript. The transcript
// goes to the model as data only; whatever comes back is re-checked here and nothing is trusted:
// a field without a span that exists in the transcript is rejected, a next date is accepted only
// when the parser reads the quoted phrase to the same date, and instruction-like speech never
// changes the schema or triggers anything: items inside it are rejected and the capture goes to
// Needs you.
import type { AiGateway, RunContext } from '@causedeck/ai';

import {
  foldText,
  spanInside,
  ValidatedHearingSchema,
  type FlaggedSpan,
  type NeedsYouReason,
  type Rejected,
  type RejectReason,
  type Span,
  type StructuredResult,
  type ValidatedHearing,
} from './schema.ts';
import { parseSpokenDate } from './spoken-dates.ts';

interface Spanned {
  text: string;
  span: Span;
}

/** What the gateway task returns; every part may be wrong and is checked below. */
export interface RawHearing {
  matterRef?: Spanned | null | undefined;
  outcome?: Spanned | null | undefined;
  adjournmentReason?: Spanned | null | undefined;
  nextDate?: { date: string | null; phrase: string; span: Span } | null | undefined;
  stageAfter?: Spanned | null | undefined;
  directions?:
    { text: string; dueExpression?: string | null | undefined; span: Span }[] | undefined;
  tasks?: { title: string; span: Span }[] | undefined;
  confidence: number;
}

/** Speech that tries to instruct the system rather than describe the hearing. */
const INSTRUCTION_LIKE: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:instructions?|rules?|prompt|above|previous)\b/giu,
  /\b(?:system|developer)\s+(?:prompt|message|instruction)s?\b/giu,
  /\byou\s+are\s+now\b/giu,
  /\b(?:act|behave|respond)\s+as\s+(?:if|an?|the)\b/giu,
  /\b(?:reveal|print|repeat)\b[^.]{0,30}\b(?:prompt|instructions?|secrets?|keys?)\b/giu,
  /\b(?:delete|erase|remove)\s+(?:all|every|the)\b[^.]{0,30}\b(?:matters?|records?|data|files?)\b/giu,
  /\b(?:e-?file|file\s+(?:the|an?)\s+\w+\s+(?:online|now)|send\s+(?:an?\s+)?(?:email|message|whatsapp|notice)|transfer\s+(?:the\s+)?(?:money|funds?)|pay\s+(?:the\s+)?(?:fee|invoice)s?)\b/giu,
  /\b(?:set|mark|change)\s+(?:the\s+)?(?:next\s+date|status|level|schema)\b[^.]{0,20}\bto\b/giu,
  /\bnew\s+instructions?\b/giu,
];

/** The instruction-like stretches of `text`. */
export function flagInstructionLike(text: string): FlaggedSpan[] {
  const flagged: FlaggedSpan[] = [];
  for (const re of INSTRUCTION_LIKE) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      flagged.push({
        span: { start: match.index, end: match.index + match[0].length },
        reason: 'instruction_like',
      });
    }
  }
  return flagged.sort((a, b) => a.span.start - b.span.start);
}

const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;

export interface StructureHearingInput {
  /** The transcript text; spans are offsets into it. */
  transcript: string;
  /** `YYYY-MM-DD`: relative phrases are read against it and the next date must follow it. */
  hearingDate: string;
  languageHints?: readonly string[] | undefined;
}

export interface StructureHearingOptions {
  gateway: AiGateway;
  scope: Pick<RunContext, 'workspaceId' | 'captureId' | 'matterId' | 'userId'>;
  pipelineVersion: string;
}

export function structureHearing(
  options: StructureHearingOptions,
): (input: StructureHearingInput) => Promise<StructuredResult> {
  const { gateway, scope, pipelineVersion } = options;
  return async (input) => {
    const result = await gateway.run<RawHearing>(
      'structure_hearing',
      {
        transcript: input.transcript,
        hearingDate: input.hearingDate,
        ...(input.languageHints === undefined ? {} : { languageHints: [...input.languageHints] }),
      },
      {
        ...scope,
        purpose: 'capture.structure_hearing',
        idempotencyKey: `capture-structure:${scope.captureId ?? 'none'}:${pipelineVersion}`,
      },
    );
    return validateHearing(result.output, input);
  };
}

/** Checks a model reading of a transcript; pure, so tests and the eval run it without a gateway. */
export function validateHearing(raw: RawHearing, input: StructureHearingInput): StructuredResult {
  const { transcript, hearingDate } = input;
  const flagged = flagInstructionLike(transcript);
  const rejected: Rejected[] = [];
  const reasons = new Set<NeedsYouReason>();

  /** The span when it is acceptable; otherwise the field is rejected and null returned. */
  const accept = (field: string, span: Span | undefined, value: unknown): Span | null => {
    const fail = (reason: RejectReason): null => {
      rejected.push({ field, reason, value });
      return null;
    };
    if (span === undefined) return fail('span_missing');
    if (!spanInside(span, transcript.length)) return fail('span_out_of_range');
    if (flagged.some((f) => overlaps(f.span, span))) return fail('instruction_like');
    return { start: span.start, end: span.end };
  };

  const plain = (field: string, item: Spanned | null | undefined) => {
    if (item === null || item === undefined) return undefined;
    const span = accept(field, item.span, item);
    return span === null ? undefined : { text: item.text, span };
  };

  const structured: Record<string, unknown> = {};
  const matterRef = plain('matterRef', raw.matterRef);
  if (matterRef !== undefined) structured['matterRef'] = matterRef;
  const outcome = plain('outcome', raw.outcome);
  if (outcome !== undefined) structured['outcome'] = outcome;
  else reasons.add('outcome_dropped');
  const adjournmentReason = plain('adjournmentReason', raw.adjournmentReason);
  if (adjournmentReason !== undefined) structured['adjournmentReason'] = adjournmentReason;
  const stageAfter = plain('stageAfter', raw.stageAfter);
  if (stageAfter !== undefined) structured['stageAfter'] = stageAfter;

  if (raw.nextDate !== null && raw.nextDate !== undefined) {
    const next = acceptNextDate(raw.nextDate, input, accept, rejected);
    if (next === null) reasons.add('next_date_dropped');
    else structured['nextDate'] = next;
  }

  structured['directions'] = (raw.directions ?? []).flatMap((direction, i) => {
    const field = `directions[${String(i)}]`;
    const span = accept(field, direction.span, direction);
    if (span === null) return [];
    const entry: Record<string, unknown> = { text: direction.text, span };
    const expression = direction.dueExpression;
    if (expression !== null && expression !== undefined) {
      const date = acceptDue(
        `${field}.dueExpression`,
        expression,
        transcript,
        hearingDate,
        rejected,
      );
      if (date !== null) {
        entry['dueExpression'] = expression;
        entry['dueDate'] = date;
      }
    }
    return [entry];
  });
  structured['tasks'] = (raw.tasks ?? []).flatMap((task, i) => {
    const span = accept(`tasks[${String(i)}]`, task.span, task);
    return span === null ? [] : [{ title: task.title, span }];
  });

  if (flagged.length > 0) reasons.add('instruction_like_speech');
  const parsed = ValidatedHearingSchema.safeParse(structured);
  if (!parsed.success) {
    // A malformed value (empty text, over-long list) drops the whole reading to the person.
    rejected.push({ field: 'structured', reason: 'span_missing', value: raw });
    return {
      structured: { directions: [], tasks: [] },
      rejected,
      flagged,
      needsYou: { reasons: [...reasons, 'outcome_dropped'] },
      confidence: 0,
    };
  }
  return {
    structured: parsed.data,
    rejected,
    flagged,
    needsYou: reasons.size === 0 ? null : { reasons: [...reasons] },
    confidence: Math.min(1, Math.max(0, raw.confidence)),
  };
}

function acceptNextDate(
  next: NonNullable<RawHearing['nextDate']>,
  { transcript, hearingDate }: StructureHearingInput,
  accept: (field: string, span: Span | undefined, value: unknown) => Span | null,
  rejected: Rejected[],
): ValidatedHearing['nextDate'] | null {
  const span = accept('nextDate', next.span, next);
  if (span === null) return null;
  const drop = (reason: RejectReason): null => {
    rejected.push({ field: 'nextDate', reason, value: next });
    return null;
  };
  const quoted = transcript.slice(span.start, span.end);
  if (foldText(quoted) !== foldText(next.phrase)) return drop('phrase_mismatch');
  const date = parseSpokenDate(quoted, hearingDate);
  if (date === null) return drop('date_untraceable');
  if (next.date !== null && next.date !== date) return drop('date_mismatch');
  if (date <= hearingDate) return drop('not_after_hearing');
  return { date, phrase: quoted, span };
}

function acceptDue(
  field: string,
  expression: string,
  transcript: string,
  hearingDate: string,
  rejected: Rejected[],
): string | null {
  const at = transcript.toLowerCase().indexOf(expression.trim().toLowerCase());
  const date = at === -1 ? null : parseSpokenDate(expression, hearingDate);
  if (date === null) {
    rejected.push({
      field,
      reason: at === -1 ? 'span_missing' : 'date_untraceable',
      value: expression,
    });
  }
  return date;
}
