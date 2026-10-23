// A0 validator-last (#56): the code, not the model, decides what survives. A model row is kept only
// if its quote is on its page and the case number it claims is inside that quote; a date only if a
// literal rendering is inside the quote (`datePresence`); a CNR only if it has the 16-character
// structure and is written in the quote. Everything else goes to `rejected[]` with its reason,
// never silently dropped. A0 is lower trust than a dedicated adapter, so confidence is capped at
// 0.85 until the person has confirmed a row of the same list (see `confirmation.ts`), and a
// document with instruction-like text is routed to "Needs you" with its dates demoted. Orders reuse
// the rules of #46 (`validateExtraction`) and add CNRs, parties and the forum identity.
import {
  datePresence,
  looksLikeInjection,
  normaliseQuote,
  preParse,
  validateExtraction,
  verifyAnchor,
  type ModelOrderOutput,
  type OrderExtraction,
  type PageText,
  type Rejected,
} from '../extract/index.ts';
import { detectLanguage } from '../language/detect.ts';

import { matchKey, type BBox, type LayoutDocument } from '@causedeck/adapters';

import { CNR_PATTERN, findCaseRefs, type CaseTypeLookup } from './patterns.ts';
import { skeletonPass, type Skeleton, type SkeletonRow } from './skeleton.ts';

/** Stored with every A0 result; bump it when rules change so old rows stay comparable. */
export const A0_PIPELINE_VERSION = 'a0.v1';
/** The most an A0 row claims until a human has confirmed a row of the same list. */
export const A0_CONFIDENCE_CAP = 0.85;
/** The most it may show after one confirmed row of the same list (display only; level stays L2). */
export const A0_CONFIRMED_CAP = 0.95;
/** The most a deterministic-only row claims (no model corroborated it). */
export const A0_SKELETON_CONFIDENCE = 0.6;
const MODEL_ONLY_CONFIDENCE = 0.7;
const CORROBORATED_CONFIDENCE = 0.8;
const SUSPICIOUS_CONFIDENCE = 0.5;
export const READ_WITHOUT_AI_NOTE = 'read without AI';

export type A0AiSkip = 'blocked' | 'budget' | 'unavailable';
export type A0NeedsYouReason = 'injection_suspected' | 'no_rows' | 'ocr_needed' | 'low_confidence';
export type A0IssueCode =
  | 'unknown_case_type'
  | 'unverified_case_type'
  | 'read_without_ai'
  | 'fuzzy_anchor'
  | 'model_only'
  | 'injection_suspected';

export interface A0Issue {
  code: A0IssueCode;
  message: string;
}

export interface A0Anchor {
  page: number;
  quote: string;
  charStart: number;
  charEnd: number;
  /** 1-based line of the page the quote starts on, computed from the page text. */
  lineRef: number;
  bbox?: BBox;
}

export interface A0CaseRef {
  caseTypeRaw: string;
  caseType: string;
  caseNumber: string;
  caseYear: number;
  /** The type is in a registered adapter's nomenclature or the district types. */
  known: boolean;
  /** Confirmed from an official source; false for CCCA and any type we only guessed. */
  verified: boolean;
  matchKey: string | null;
}

/** A party as printed (original script kept) with spelling-tolerant aliases; never transliterated. */
export interface A0Party {
  original: string;
  aliases: string[];
}

export interface A0Date {
  literal: string;
  iso: string;
  anchor: A0Anchor;
}

export interface A0Row {
  /** The identity: the CNR when present, else forum + normalised case type + number + year. */
  key: string;
  caseRef?: A0CaseRef;
  cnr?: string;
  parties?: A0Party;
  stageText?: string;
  hall?: string;
  serial?: string;
  dates?: A0Date[];
  anchor: A0Anchor;
  confidence: number;
  origin: 'skeleton' | 'model' | 'both';
  /** `en`, `ta`, `kn`, `ta+en` or `kn+en` for the row's own text. */
  language: string | null;
  /** The case type is confirmed (see `A0CaseRef.verified`). */
  verified: boolean;
  issues: A0Issue[];
  note?: string;
}

export interface A0Diagnostics {
  pages: number;
  skeletonRows: number;
  modelRows: number;
  tableRows: number;
  modelUsed: boolean;
  aiSkipped: A0AiSkip | null;
  suspicious: boolean;
  language: string | null;
  needsYou: A0NeedsYouReason[];
  unknownCaseTypes: string[];
}

export interface A0ParsedList {
  forumCode: string;
  listDate?: A0Date;
  rows: A0Row[];
  rejected: Rejected[];
  diagnostics: A0Diagnostics;
}

/** The `parse_list_a0` answer (claims, never trusted). */
export interface ModelListOutput {
  listDate: { date: string; page: number; quote: string } | null;
  rows: {
    page: number;
    quote: string;
    caseNumber: string;
    cnr: string | null;
    serial: string | null;
    parties: string | null;
    stageText: string | null;
    hall: string | null;
    dates: string[];
  }[];
  confidence: number;
}

/** The `parse_order_a0` answer (claims, never trusted). */
export interface ModelA0OrderOutput {
  caseNumbers: { value: string; page: number; quote: string }[];
  cnrs: { value: string; page: number; quote: string }[];
  parties: { name: string; page: number; quote: string }[];
  orderDate: { date: string; page: number; quote: string } | null;
  orderType: ModelOrderOutput['orderType'];
  directions: ModelOrderOutput['directions'];
  nextDate: ModelOrderOutput['nextDate'];
  confidence: number;
}

export interface ValidateListInput {
  documentId: string;
  forumCode: string;
  pages: readonly PageText[];
  skeleton: Skeleton;
  /** `null` when no model ran. */
  model: ModelListOutput | null;
  aiSkipped?: A0AiSkip | null;
  layout?: LayoutDocument | undefined;
  /** Fuzzy anchor matching on OCR pages. */
  fuzzy?: boolean;
  lookup: CaseTypeLookup;
  pivot?: number;
}

const loose = (s: string): string =>
  normaliseQuote(s)
    .toLowerCase()
    .replace(/[\s.,;:]+/g, '');
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The identity of a case: the CNR, else forum + normalised type + number + year. */
export function identityKey(parts: {
  forumCode: string;
  cnr?: string | null | undefined;
  caseType?: string | null | undefined;
  caseNumber?: string | null | undefined;
  caseYear?: number | null | undefined;
}): string {
  if (parts.cnr != null && CNR_PATTERN.test(parts.cnr)) return `cnr:${parts.cnr}`;
  const key = matchKey({
    caseType: parts.caseType ?? null,
    caseNumber: parts.caseNumber ?? null,
    caseYear: parts.caseYear ?? null,
  });
  return `${parts.forumCode}|${key ?? 'unknown'}`;
}

const TITLES = /^(?:mr|mrs|ms|miss|smt|sri|shri|thiru|tmt|selvi|dr|m\/s|messrs)\.?\s+/i;

/** Spelling-tolerant aliases of a party name; the original script is kept, nothing is translated. */
export function partyAliases(raw: string): A0Party {
  const original = squash(raw.normalize('NFKC'));
  const aliases = new Set<string>();
  let base = original;
  while (TITLES.test(base)) base = base.replace(TITLES, '');
  const stripped = squash(base.replace(/[.,;:()[\]]/g, ' ').replace(/\s*&\s*/g, ' AND '));
  const upper = stripped.toUpperCase();
  if (upper !== '') aliases.add(upper);
  if (upper !== '') aliases.add(upper.replace(/\s+/g, ''));
  const latin = upper.replace(/([A-Z])\1+/g, '$1');
  if (/[A-Z]/.test(latin)) {
    aliases.add(latin);
    aliases.add(latin.replace(/\s+/g, ''));
  }
  aliases.delete(original);
  return { original, aliases: [...aliases] };
}

/** The anchor of `quote` on `page`, offsets and line computed from the stored page text. */
function anchorOf(
  pages: readonly PageText[],
  page: number,
  quote: string,
  fuzzy: boolean,
  layout: LayoutDocument | undefined,
): { anchor: A0Anchor; fuzzy: boolean } | null {
  const result = verifyAnchor({ page, quote }, pages, fuzzy ? { fuzzy: true } : {});
  if (!result.ok) return null;
  const text = pages.find((p) => p.pageNo === page)?.text ?? '';
  const exact = text.slice(result.charStart, result.charEnd);
  const lineRef = text.slice(0, result.charStart).split('\n').length;
  const lineText = squash(exact);
  const box = layout?.pages
    .find((p) => p.page === page)
    ?.items.find((item) => squash(item.text).includes(lineText) && lineText !== '');
  return {
    anchor: {
      page,
      quote: exact.slice(0, 2000),
      charStart: result.charStart,
      charEnd: result.charEnd,
      lineRef,
      ...(box === undefined ? {} : { bbox: box.bbox }),
    },
    fuzzy: result.fuzzy,
  };
}

function caseRefOf(hit: {
  caseTypeRaw: string;
  caseType: string;
  caseNumber: string;
  caseYear: number;
  known: boolean;
  verified: boolean;
}): A0CaseRef {
  return {
    caseTypeRaw: hit.caseTypeRaw,
    caseType: hit.caseType,
    caseNumber: hit.caseNumber,
    caseYear: hit.caseYear,
    known: hit.known,
    verified: hit.verified,
    matchKey: matchKey({
      caseType: hit.caseType,
      caseNumber: hit.caseNumber,
      caseYear: hit.caseYear,
    }),
  };
}

const typeIssues = (ref: A0CaseRef): A0Issue[] =>
  !ref.known
    ? [{ code: 'unknown_case_type', message: `Case type ${ref.caseTypeRaw} is not recognised` }]
    : ref.verified
      ? []
      : [
          {
            code: 'unverified_case_type',
            message: `Case type ${ref.caseTypeRaw} is not confirmed from an official source`,
          },
        ];

function skeletonRowToA0(
  row: SkeletonRow,
  input: ValidateListInput,
): { row: A0Row; fuzzy: boolean } | null {
  const found = anchorOf(
    input.pages,
    row.page,
    row.quote.trim(),
    input.fuzzy === true,
    input.layout,
  );
  if (found === null) return null;
  const caseRef = caseRefOf(row.ref);
  const dates: A0Date[] = row.dates.map((d) => ({
    literal: d.literal,
    iso: d.date,
    anchor: found.anchor,
  }));
  return {
    fuzzy: found.fuzzy,
    row: {
      key: identityKey({ forumCode: input.forumCode, cnr: row.cnr, ...caseRef }),
      caseRef,
      ...(row.cnr === null ? {} : { cnr: row.cnr }),
      ...(row.parties === null ? {} : { parties: partyAliases(row.parties) }),
      ...(row.stageText === null ? {} : { stageText: row.stageText }),
      ...(row.hall === null ? {} : { hall: row.hall }),
      ...(row.serial === null ? {} : { serial: row.serial }),
      ...(dates.length === 0 ? {} : { dates }),
      anchor: found.anchor,
      confidence: A0_SKELETON_CONFIDENCE,
      origin: 'skeleton',
      language: detectLanguage(found.anchor.quote),
      verified: caseRef.verified,
      issues: typeIssues(caseRef),
    },
  };
}

/** Validate the skeleton and the model's claims into the A0 list; nothing is dropped silently. */
export function validateList(input: ValidateListInput): A0ParsedList {
  const { pages, skeleton, model, forumCode } = input;
  const rejected: Rejected[] = [];
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
  const suspicious = pages.some((p) => looksLikeInjection(p.text));
  const fuzzyOn = input.fuzzy === true;
  const rows = new Map<string, A0Row>();
  const penalties = new Map<string, number>();

  for (const raw of skeleton.rows) {
    const made = skeletonRowToA0(raw, input);
    if (made === null) {
      reject('rows', 'no_anchor', raw.quote, raw.page);
      continue;
    }
    const existing = rows.get(made.row.key);
    if (existing === undefined) {
      rows.set(made.row.key, made.row);
      if (made.fuzzy) penalties.set(made.row.key, 0.15);
    }
  }

  const claims = model?.rows ?? [];
  claims.forEach((claim, index) => {
    const field = `rows[${String(index)}]`;
    const found = anchorOf(pages, claim.page, claim.quote, fuzzyOn, input.layout);
    if (found === null) {
      reject(field, 'no_anchor', claim.quote, claim.page);
      return;
    }
    const quoteRefs = findCaseRefs(
      found.anchor.quote,
      input.lookup,
      input.pivot === undefined ? {} : { pivot: input.pivot },
    );
    const claimed = findCaseRefs(
      claim.caseNumber,
      input.lookup,
      input.pivot === undefined ? {} : { pivot: input.pivot },
    )[0];
    const hit =
      claimed === undefined
        ? undefined
        : quoteRefs.find(
            (q) =>
              q.caseType === claimed.caseType &&
              q.caseNumber === claimed.caseNumber &&
              q.caseYear === claimed.caseYear,
          );
    if (hit === undefined) {
      // The case number must be inside the quote: not parsed there, or only as plain text.
      if (claimed !== undefined || !loose(found.anchor.quote).includes(loose(claim.caseNumber))) {
        reject(`${field}.caseNumber`, 'no_anchor', claim.caseNumber, claim.page);
        return;
      }
    }
    const refHit = hit ?? quoteRefs[0];
    if (refHit === undefined) {
      reject(`${field}.caseNumber`, 'no_anchor', claim.caseNumber, claim.page);
      return;
    }
    const caseRef = caseRefOf(refHit);
    let cnr: string | undefined;
    if (claim.cnr !== null) {
      if (CNR_PATTERN.test(claim.cnr) && found.anchor.quote.includes(claim.cnr)) cnr = claim.cnr;
      else reject(`${field}.cnr`, 'no_anchor', claim.cnr, claim.page);
    }
    const pageText = pages.find((p) => p.pageNo === claim.page)?.text ?? '';
    let parties: A0Party | undefined;
    if (claim.parties !== null) {
      if (loose(found.anchor.quote).includes(loose(claim.parties)))
        parties = partyAliases(claim.parties);
      else reject(`${field}.parties`, 'no_anchor', claim.parties, claim.page);
    }
    const onPage = (name: string, value: string | null): string | undefined => {
      if (value === null) return undefined;
      if (loose(pageText).includes(loose(value))) return value;
      reject(`${field}.${name}`, 'no_anchor', value, claim.page);
      return undefined;
    };
    const stageText = onPage('stageText', claim.stageText);
    const hall = onPage('hall', claim.hall);
    const dates: A0Date[] = [];
    for (const iso of claim.dates) {
      const literal = datePresence(iso, found.anchor.quote);
      if (literal === null) reject(`${field}.dates`, 'date_not_in_source', iso, claim.page);
      else dates.push({ literal: literal.literal, iso, anchor: found.anchor });
    }
    const key = identityKey({ forumCode, cnr, ...caseRef });
    const existing = rows.get(key);
    if (existing === undefined) {
      rows.set(key, {
        key,
        caseRef,
        ...(cnr === undefined ? {} : { cnr }),
        ...(parties === undefined ? {} : { parties }),
        ...(stageText === undefined ? {} : { stageText }),
        ...(hall === undefined ? {} : { hall }),
        ...(claim.serial === null || !loose(found.anchor.quote).includes(loose(claim.serial))
          ? {}
          : { serial: claim.serial }),
        ...(dates.length === 0 ? {} : { dates }),
        anchor: found.anchor,
        confidence: Math.min(model?.confidence ?? 1, MODEL_ONLY_CONFIDENCE),
        origin: 'model',
        language: detectLanguage(found.anchor.quote),
        verified: caseRef.verified,
        issues: [
          ...typeIssues(caseRef),
          { code: 'model_only', message: 'Read by the model only; no deterministic match' },
        ],
      });
      if (found.fuzzy) penalties.set(key, 0.15);
    } else {
      // Corroborated by the skeleton: the deterministic fields stand, the model fills the gaps.
      const known = new Set((existing.dates ?? []).map((d) => d.iso));
      const added = dates.filter((d) => !known.has(d.iso));
      rows.set(key, {
        ...existing,
        origin: 'both',
        confidence: Math.min(model?.confidence ?? 1, CORROBORATED_CONFIDENCE),
        ...(existing.cnr === undefined && cnr !== undefined ? { cnr } : {}),
        ...(existing.parties === undefined && parties !== undefined ? { parties } : {}),
        ...(existing.stageText === undefined && stageText !== undefined ? { stageText } : {}),
        ...(existing.hall === undefined && hall !== undefined ? { hall } : {}),
        ...(added.length === 0 ? {} : { dates: [...(existing.dates ?? []), ...added] }),
      });
    }
  });

  const aiSkipped = input.aiSkipped ?? (model === null ? 'unavailable' : null);
  const finished: A0Row[] = [...rows.values()].map((row) => {
    let confidence = row.confidence - (penalties.get(row.key) ?? 0);
    const issues = [...row.issues];
    let note = row.note;
    let dates = row.dates;
    if (model === null) {
      issues.push({ code: 'read_without_ai', message: READ_WITHOUT_AI_NOTE });
      note = READ_WITHOUT_AI_NOTE;
    }
    if (penalties.has(row.key))
      issues.push({ code: 'fuzzy_anchor', message: 'Matched approximately on an OCR page' });
    if (suspicious) {
      issues.push({
        code: 'injection_suspected',
        message: 'The document holds instruction-like text',
      });
      confidence = Math.min(confidence, SUSPICIOUS_CONFIDENCE);
      for (const d of dates ?? []) reject('dates', 'injection_demoted', d.iso, d.anchor.page);
      dates = undefined;
    }
    confidence = Math.max(0, Math.min(A0_CONFIDENCE_CAP, Math.round(confidence * 1000) / 1000));
    const rest: A0Row = { ...row };
    delete rest.dates;
    delete rest.note;
    return {
      ...rest,
      ...(dates === undefined ? {} : { dates }),
      ...(note === undefined ? {} : { note }),
      confidence,
      issues,
    };
  });

  let listDate: A0Date | undefined;
  const sk = skeleton.listDate;
  if (sk !== null) {
    const a = anchorOf(pages, sk.page, sk.quote.trim(), fuzzyOn, input.layout);
    if (a !== null && !suspicious)
      listDate = { literal: sk.literal, iso: sk.date, anchor: a.anchor };
  }
  const claimedDate = model?.listDate;
  if (claimedDate != null) {
    const a = anchorOf(pages, claimedDate.page, claimedDate.quote, fuzzyOn, input.layout);
    const literal = a === null ? null : datePresence(claimedDate.date, a.anchor.quote);
    if (a === null) reject('listDate', 'no_anchor', claimedDate.quote, claimedDate.page);
    else if (literal === null)
      reject('listDate', 'date_not_in_source', claimedDate.date, claimedDate.page);
    else if (suspicious)
      reject('listDate', 'injection_demoted', claimedDate.date, claimedDate.page);
    else if (listDate === undefined)
      listDate = { literal: literal.literal, iso: claimedDate.date, anchor: a.anchor };
    else if (listDate.iso !== claimedDate.date)
      reject('listDate', 'conflict', claimedDate.date, claimedDate.page);
  }

  const needsYou: A0NeedsYouReason[] = [];
  if (suspicious) needsYou.push('injection_suspected');
  if (pages.every((p) => p.text.trim() === '')) needsYou.push('ocr_needed');
  else if (finished.length === 0) needsYou.push('no_rows');
  if (finished.some((r) => r.confidence < 0.5) && !needsYou.includes('injection_suspected'))
    needsYou.push('low_confidence');

  return {
    forumCode,
    ...(listDate === undefined ? {} : { listDate }),
    rows: finished,
    rejected,
    diagnostics: {
      pages: pages.length,
      skeletonRows: skeleton.rows.length,
      modelRows: claims.length,
      tableRows: skeleton.tableRows,
      modelUsed: model !== null,
      aiSkipped,
      suspicious,
      language: skeleton.language,
      needsYou,
      unknownCaseTypes: [
        ...new Set(
          finished
            .filter((r) => r.caseRef?.known === false)
            .map((r) => r.caseRef?.caseTypeRaw ?? ''),
        ),
      ],
    },
  };
}

/** One identity an order is about (a case number in the order, or its CNR). */
export interface A0Identity {
  key: string;
  caseRef?: A0CaseRef;
  cnr?: string;
}

export interface A0ParsedOrder {
  forumCode: string;
  extraction: OrderExtraction;
  cnrs: { value: string; anchor: A0Anchor }[];
  parties: { name: string; party: A0Party; anchor: A0Anchor }[];
  identities: A0Identity[];
  rejected: Rejected[];
  language: string | null;
  /** Never above the A0 cap; `extraction.confidence` is the raw #46 figure. */
  confidence: number;
  verified: boolean;
  issues: A0Issue[];
  diagnostics: Pick<A0Diagnostics, 'pages' | 'modelUsed' | 'aiSkipped' | 'suspicious' | 'language'>;
}

export interface ValidateOrderInput {
  documentId: string;
  forumCode: string;
  pages: readonly PageText[];
  model: ModelA0OrderOutput | null;
  aiSkipped?: A0AiSkip | null;
  fuzzy?: boolean;
  lookup: CaseTypeLookup;
  pivot?: number;
}

/** Validate an order: the rules of #46, plus CNRs, parties and the forum identity. */
export function validateOrder(input: ValidateOrderInput): A0ParsedOrder {
  const { pages, model, forumCode } = input;
  const pivot = input.pivot === undefined ? {} : { pivot: input.pivot };
  const asModel: ModelOrderOutput | null =
    model === null
      ? null
      : {
          bench: [],
          orderDate: model.orderDate,
          caseNumbers: model.caseNumbers,
          neutralCitation: null,
          orderType: model.orderType,
          directions: model.directions,
          nextDate: model.nextDate,
          stageCues: [],
          confidence: model.confidence,
        };
  const extraction = validateExtraction({
    documentId: input.documentId,
    pipelineVersion: A0_PIPELINE_VERSION,
    pages,
    pre: preParse(pages),
    model: asModel,
    ...(input.fuzzy === true ? { fuzzy: true } : {}),
  });
  const rejected: Rejected[] = [...extraction.rejected];
  const fuzzy = input.fuzzy === true;

  const sk = skeletonPass(pages, { lookup: input.lookup, ...pivot });
  const cnrs = new Map<string, A0Anchor>();
  for (const found of sk.cnrs) {
    const a = anchorOf(pages, found.page, found.quote, false, undefined);
    if (a !== null) cnrs.set(found.value, a.anchor);
  }
  for (const claim of model?.cnrs ?? []) {
    const a = anchorOf(pages, claim.page, claim.quote, fuzzy, undefined);
    if (a === null || !CNR_PATTERN.test(claim.value) || !a.anchor.quote.includes(claim.value)) {
      rejected.push({
        field: 'cnrs',
        reason: 'no_anchor',
        value: claim.value.slice(0, 2000),
        page: claim.page,
      });
    } else if (!cnrs.has(claim.value)) cnrs.set(claim.value, a.anchor);
  }

  const parties: A0ParsedOrder['parties'] = [];
  for (const claim of model?.parties ?? []) {
    const a = anchorOf(pages, claim.page, claim.quote, fuzzy, undefined);
    if (a === null || !loose(a.anchor.quote).includes(loose(claim.name))) {
      rejected.push({
        field: 'parties',
        reason: 'no_anchor',
        value: claim.name.slice(0, 2000),
        page: claim.page,
      });
    } else parties.push({ name: claim.name, party: partyAliases(claim.name), anchor: a.anchor });
  }

  const identities = new Map<string, A0Identity>();
  let verified = true;
  const unknown: A0Issue[] = [];
  // The identities are the case numbers the order prints (the skeleton knows the district types the
  // #46 pre-parse does not) and the ones the extraction anchored.
  const hits = [
    ...sk.rows.map((r) => r.ref),
    ...extraction.caseNumbers.flatMap((c) =>
      findCaseRefs(c.value, input.lookup, pivot).slice(0, 1),
    ),
  ];
  for (const hit of hits) {
    const caseRef = caseRefOf(hit);
    const key = identityKey({ forumCode, ...caseRef });
    identities.set(key, { key, caseRef });
    verified = verified && caseRef.verified;
    unknown.push(...typeIssues(caseRef));
  }
  for (const value of cnrs.keys()) {
    const key = identityKey({ forumCode, cnr: value });
    identities.set(key, { key, cnr: value });
  }

  const suspicious = extraction.suspicious;
  const issues: A0Issue[] = [...unknown];
  if (model === null) issues.push({ code: 'read_without_ai', message: READ_WITHOUT_AI_NOTE });
  if (suspicious)
    issues.push({
      code: 'injection_suspected',
      message: 'The document holds instruction-like text',
    });
  const language = detectLanguageOfPages(pages);
  return {
    forumCode,
    extraction,
    cnrs: [...cnrs].map(([value, anchor]) => ({ value, anchor })),
    parties,
    identities: [...identities.values()],
    rejected,
    language,
    confidence: Math.min(extraction.confidence, A0_CONFIDENCE_CAP),
    verified: verified && identities.size > 0,
    issues,
    diagnostics: {
      pages: pages.length,
      modelUsed: model !== null,
      aiSkipped: input.aiSkipped ?? (model === null ? 'unavailable' : null),
      suspicious,
      language,
    },
  };
}

function detectLanguageOfPages(pages: readonly PageText[]): string | null {
  return detectLanguage(pages.map((p) => p.text).join('\n'));
}
