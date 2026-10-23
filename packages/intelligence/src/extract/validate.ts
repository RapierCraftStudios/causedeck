// Validator-last (#46): the code, not the model, decides what survives. Every field of the model
// output and of the pre-parse becomes an anchored field or a `rejected[]` entry with its reason;
// nothing is dropped silently. The rules (docs/product/09 §4.4):
//   * a field whose quote is not on its page is removed (`no_anchor`);
//   * an absolute date survives only if a literal rendering is inside its anchored quote
//     (`date_not_in_source` otherwise); relative dates are computed here, never taken from the model;
//   * a date inside a reference to an earlier order, an impugned order, a statute or a limitation
//     period is never the next date (`decoy_date`);
//   * several next dates, or a model that disagrees with the pre-parse, make the extraction
//     `ambiguous`: all candidates are returned and none is chosen;
//   * instruction-like text makes it `suspicious` and demotes every date to "Needs you".
import { normaliseQuote, verifyAnchor, type PageText } from './anchors.ts';
import { datePresence } from './dates.ts';
import type { DateCandidate, NextDateCandidate, PreParse, Span } from './preparse.ts';
import { resolveRelative, type Derivation } from './relative.ts';
import type {
  Direction,
  DirectionKind,
  ExtractionAnchor,
  ExtractionNeedsYouReason,
  NextDate,
  OrderExtraction,
  Rejected,
} from './schema.ts';

/** The model's answer (the `extract_order` task output); every quote is claimed, not trusted. */
export interface ModelOrderOutput {
  bench: { name: string; page: number; quote: string }[];
  orderDate: { date: string; page: number; quote: string } | null;
  caseNumbers: { value: string; page: number; quote: string }[];
  neutralCitation: { value: string; page: number; quote: string } | null;
  orderType: 'interim' | 'final' | 'procedural';
  directions: {
    text: string;
    kind: DirectionKind;
    dueExpression: string | null;
    dueDate: string | null;
    page: number;
    quote: string;
  }[];
  nextDate: { date: string | null; phrase: string; page: number; quote: string } | null;
  stageCues: { stage: string; page: number; quote: string }[];
  confidence: number;
}

export interface ValidateInput {
  documentId: string;
  pipelineVersion: string;
  pages: readonly PageText[];
  pre: PreParse;
  /** `null` when no model ran (deterministic only, or the call failed). */
  model: ModelOrderOutput | null;
  /** Fuzzy anchor matching on OCR pages. */
  fuzzy?: boolean;
}

/** The most confidence a deterministic-only extraction can claim (no model corroborated it). */
export const DETERMINISTIC_MAX_CONFIDENCE = 0.6;
/** Below this the extraction goes to "Needs you" as low confidence. */
export const LOW_CONFIDENCE = 0.5;
const SUSPICIOUS_MAX_CONFIDENCE = 0.5;

const squash = (s: string): string => normaliseQuote(s).toLowerCase();
const loose = (s: string): string => s.toLowerCase().replace(/[\s.]+/g, '');

const spanAnchor = (documentId: string, s: Span): ExtractionAnchor => ({
  documentId,
  page: s.page,
  quote: s.quote.slice(0, 2000),
  charStart: s.start,
  charEnd: s.end,
});

const overlaps = (a: Span, b: Span): boolean =>
  a.page === b.page && a.start < b.end && b.start < a.end;

export function validateExtraction(input: ValidateInput): OrderExtraction {
  const { documentId, pages, pre, model } = input;
  const rejected: Rejected[] = [];
  let penalty = 0;

  const reject = (
    field: string,
    reason: Rejected['reason'],
    value?: string,
    page?: number,
  ): void => {
    rejected.push({
      field,
      reason,
      ...(value === undefined ? {} : { value: value.slice(0, 2000) }),
      ...(page === undefined ? {} : { page }),
    });
  };

  /** Verify a model quote; `must` is text the quote has to contain (the claimed value). */
  const anchorModel = (
    field: string,
    claim: { page: number; quote: string },
    must?: string,
  ): ExtractionAnchor | null => {
    const result = verifyAnchor(claim, pages, input.fuzzy === true ? { fuzzy: true } : {});
    const contains = must === undefined || loose(claim.quote).includes(loose(must));
    if (!result.ok || !contains) {
      reject(field, 'no_anchor', claim.quote, claim.page);
      return null;
    }
    penalty = Math.max(penalty, result.confidencePenalty);
    const page = pages.find((p) => p.pageNo === claim.page);
    return {
      documentId,
      page: claim.page,
      quote: (page?.text.slice(result.charStart, result.charEnd) ?? claim.quote).slice(0, 2000),
      charStart: result.charStart,
      charEnd: result.charEnd,
    };
  };

  /** An absolute date is real only if it is written inside the anchored quote. */
  const dateInQuote = (field: string, date: string, anchor: ExtractionAnchor): boolean => {
    if (datePresence(date, anchor.quote) !== null) return true;
    reject(field, 'date_not_in_source', date, anchor.page);
    return false;
  };

  const roleAt = (anchor: ExtractionAnchor, date: string): DateCandidate | undefined =>
    pre.dates.find(
      (d) =>
        d.page === anchor.page &&
        d.date === date &&
        d.start >= anchor.charStart &&
        d.end <= anchor.charEnd,
    );

  // Bench, case numbers, neutral citation: pre-parse spans first, model claims added if anchored.
  const bench: OrderExtraction['bench'] = [];
  const seenBench = new Set<string>();
  const addBench = (name: string, anchor: ExtractionAnchor): void => {
    const key = loose(name);
    if (seenBench.has(key)) return;
    seenBench.add(key);
    bench.push({ name, anchor });
  };
  for (const b of pre.bench) addBench(b.value, spanAnchor(documentId, b));
  for (const b of model?.bench ?? []) {
    const anchor = anchorModel('bench', b, b.name);
    if (anchor !== null) addBench(b.name, anchor);
  }

  const caseNumbers: OrderExtraction['caseNumbers'] = [];
  const seenCases = new Set<string>();
  const addCase = (value: string, anchor: ExtractionAnchor): void => {
    const key = loose(value);
    if (seenCases.has(key)) return;
    seenCases.add(key);
    caseNumbers.push({ value, anchor });
  };
  for (const c of pre.caseNumbers) addCase(c.value, spanAnchor(documentId, c));
  for (const c of model?.caseNumbers ?? []) {
    const anchor = anchorModel('caseNumbers', c, c.value);
    if (anchor !== null) addCase(c.value, anchor);
  }

  let neutralCitation: OrderExtraction['neutralCitation'];
  const citation = pre.neutralCitations[0];
  if (citation !== undefined) {
    neutralCitation = { value: citation.value, anchor: spanAnchor(documentId, citation) };
  } else if (model?.neutralCitation != null) {
    // No generated citations: only one written in the text is kept.
    const anchor = anchorModel(
      'neutralCitation',
      model.neutralCitation,
      model.neutralCitation.value,
    );
    if (anchor !== null) neutralCitation = { value: model.neutralCitation.value, anchor };
  }

  // Order date: the pre-parse literal wins; the model's must be anchored and written in its quote.
  let orderDate: OrderExtraction['orderDate'];
  if (pre.orderDate !== null) {
    orderDate = { date: pre.orderDate.date, anchor: spanAnchor(documentId, pre.orderDate) };
    if (model?.orderDate != null && model.orderDate.date !== pre.orderDate.date) {
      reject('orderDate', 'conflict', model.orderDate.date, model.orderDate.page);
    }
  } else if (model?.orderDate != null) {
    const anchor = anchorModel('orderDate', model.orderDate);
    if (anchor !== null && dateInQuote('orderDate', model.orderDate.date, anchor)) {
      orderDate = { date: model.orderDate.date, anchor };
    }
  }
  const basis = orderDate?.date;

  // Next date candidates.
  const candidates: NextDate[] = [];
  const addCandidate = (c: NextDate): void => {
    const same = candidates.find((x) => x.date === c.date);
    if (same === undefined) candidates.push(c);
  };
  const fromPre = (c: NextDateCandidate): NextDate => ({
    date: c.date,
    phrase: c.phrase,
    ...(c.derived ? { derived: true } : {}),
    ...(c.derivation === undefined ? {} : { derivation: c.derivation }),
    source: 'preparse',
    anchor: spanAnchor(documentId, c),
  });
  for (const c of pre.nextDates) addCandidate(fromPre(c));

  const claim = model?.nextDate ?? null;
  let modelDate: NextDate | null = null;
  if (claim !== null) {
    const anchor = anchorModel('nextDate', claim, claim.phrase);
    if (anchor !== null) {
      const relative = basis === undefined ? null : resolveRelative(claim.phrase, basis);
      if (relative !== null) {
        if (claim.date !== null && claim.date !== relative.date) {
          reject('nextDate', 'date_not_in_source', claim.date, anchor.page);
        }
        modelDate = {
          date: relative.date,
          phrase: claim.phrase,
          derived: true,
          derivation: relative.derivation,
          source: 'model',
          anchor,
        };
      } else if (claim.date !== null) {
        const role = roleAt(anchor, claim.date);
        if (role?.role === 'decoy') {
          reject('nextDate', 'decoy_date', claim.date, anchor.page);
        } else if (dateInQuote('nextDate', claim.date, anchor)) {
          modelDate = { date: claim.date, phrase: claim.phrase, source: 'model', anchor };
        }
      } else {
        reject('nextDate', 'unresolvable_relative', claim.phrase, anchor.page);
      }
    }
  }
  if (modelDate !== null) addCandidate(modelDate);

  const agree = new Set(candidates.map((c) => c.date)).size <= 1;
  if (!agree && modelDate !== null && pre.nextDates.length > 0) {
    reject('nextDate', 'conflict', modelDate.date, modelDate.anchor.page);
  }

  const suspicious = pre.suspicious;
  if (suspicious && candidates.length > 0) {
    reject('nextDate', 'injection_demoted', candidates[0]?.date);
  }
  const ambiguous = !agree;
  const nextDate = !ambiguous && !suspicious ? candidates[0] : undefined;

  // Directions: model claims anchored, then pre-parse cues the model did not cover.
  const directions: Direction[] = [];
  const resolveDue = (
    dueExpression: string | undefined,
  ): { dueDate: string; derivation: Derivation } | null => {
    if (dueExpression === undefined || basis === undefined) return null;
    const r = resolveRelative(dueExpression, basis);
    return r === null ? null : { dueDate: r.date, derivation: r.derivation };
  };
  const modelSpans: Span[] = [];
  for (const d of model?.directions ?? []) {
    const anchor = anchorModel('directions', d);
    if (anchor === null) continue;
    modelSpans.push({
      page: anchor.page,
      start: anchor.charStart,
      end: anchor.charEnd,
      quote: anchor.quote,
    });
    const expression =
      d.dueExpression !== null && squash(anchor.quote).includes(squash(d.dueExpression))
        ? d.dueExpression
        : undefined;
    if (d.dueExpression !== null && expression === undefined) {
      reject('directions.dueExpression', 'no_anchor', d.dueExpression, anchor.page);
    }
    const due = resolveDue(expression);
    let dueDate: string | undefined;
    if (due !== null) {
      dueDate = due.dueDate;
      if (d.dueDate !== null && d.dueDate !== due.dueDate) {
        reject('directions.dueDate', 'date_not_in_source', d.dueDate, anchor.page);
      }
    } else if (d.dueDate !== null && dateInQuote('directions.dueDate', d.dueDate, anchor)) {
      dueDate = d.dueDate;
    }
    directions.push({
      text: d.text,
      kind: d.kind,
      ...(expression === undefined ? {} : { dueExpression: expression }),
      ...(dueDate === undefined ? {} : { dueDate }),
      ...(due === null ? {} : { derived: true, derivation: due.derivation }),
      anchor,
    });
  }
  for (const cue of pre.directionCues) {
    if (modelSpans.some((s) => overlaps(s, cue))) continue;
    const due = resolveDue(cue.dueExpression);
    const stageOnly = /reserved|dispensed/.test(cue.cue);
    if (stageOnly) continue;
    directions.push({
      text: cue.quote.trim(),
      kind: 'compliance',
      ...(cue.dueExpression === undefined ? {} : { dueExpression: cue.dueExpression }),
      ...(due === null ? {} : { dueDate: due.dueDate, derived: true, derivation: due.derivation }),
      anchor: spanAnchor(documentId, cue),
    });
  }

  // Stage cues.
  const stageCues: OrderExtraction['stageCues'] = [];
  for (const s of model?.stageCues ?? []) {
    const anchor = anchorModel('stageCues', s);
    if (anchor !== null) stageCues.push({ stage: s.stage, anchor });
  }
  for (const cue of pre.directionCues) {
    if (!/reserved|dispensed/.test(cue.cue)) continue;
    if (
      stageCues.some(
        (s) =>
          s.anchor.page === cue.page &&
          s.anchor.charStart < cue.end &&
          cue.start < s.anchor.charEnd,
      )
    )
      continue;
    stageCues.push({ stage: cue.cue, anchor: spanAnchor(documentId, cue) });
  }

  const orderType: OrderExtraction['orderType'] =
    model?.orderType ?? guessOrderType(pages.map((p) => p.text).join('\n'));

  const deterministicOnly = model === null;
  let confidence = model?.confidence ?? DETERMINISTIC_MAX_CONFIDENCE;
  confidence -= penalty;
  confidence -= 0.05 * Math.min(rejected.length, 4);
  if (deterministicOnly) confidence = Math.min(confidence, DETERMINISTIC_MAX_CONFIDENCE);
  if (suspicious) confidence = Math.min(confidence, SUSPICIOUS_MAX_CONFIDENCE);
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 1000) / 1000));

  const needsYou: ExtractionNeedsYouReason[] = [];
  if (rejected.some((r) => r.reason !== 'conflict' && r.reason !== 'injection_demoted')) {
    needsYou.push('extraction_unanchored');
  }
  if (ambiguous) needsYou.push('extraction_ambiguous');
  if (suspicious) needsYou.push('extraction_suspicious');
  if (confidence < LOW_CONFIDENCE) needsYou.push('extraction_low_confidence');

  return {
    documentId,
    pipelineVersion: input.pipelineVersion,
    bench,
    ...(orderDate === undefined ? {} : { orderDate }),
    caseNumbers,
    ...(neutralCitation === undefined ? {} : { neutralCitation }),
    orderType,
    directions,
    ...(nextDate === undefined ? {} : { nextDate }),
    candidates,
    stageCues,
    ambiguous,
    suspicious,
    deterministicOnly,
    confidence,
    rejected,
    needsYou,
  };
}

function guessOrderType(text: string): OrderExtraction['orderType'] {
  if (/\b(?:ad-?interim|interim|stay)\b/i.test(text)) return 'interim';
  if (/\b(?:judg(?:e)?ment|dismissed|allowed|disposed\s+of)\b/i.test(text)) return 'final';
  return 'procedural';
}
