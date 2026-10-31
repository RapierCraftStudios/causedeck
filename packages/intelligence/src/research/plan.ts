// The query plan (#896, ADR 0051 §Query pipeline step 1). The gateway task `plan_research_query` turns
// the advocate's description into filters and search text; its reply is schema-validated and then
// checked again here against the closed vocabularies (subject areas, statute names, court levels,
// outcomes, dates), so a value outside them is dropped, never trusted. A rule-based planner runs first
// and its facets are merged under the model's: a plan survives a model that is down, over budget or
// wrong, and on the mock provider the statutes and subjects the advocate named still become filters.
// The advocate's own words are always searched; a plan never replaces them.
import type { AiGateway, RunContext } from '@causedeck/ai';
import { z } from 'zod';

import {
  canonicalStatute,
  equivalents,
  extractStatuteRefs,
  facetKeys,
  SUBJECT_AREAS,
  type Equivalent,
  type StatuteSection,
  type SubjectArea,
} from '../corpus/index.ts';
import { normaliseSection } from '../issues/index.ts';

import type { CourtLevel, ResearchPlan } from './types.ts';

export const PLAN_VERSION = 1;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COURT_CODE = /^[A-Z][A-Z0-9-]{1,11}$/;
const COURT_LEVELS: readonly CourtLevel[] = ['supreme_court', 'high_court', 'other'];
const OUTCOMES = ['allowed', 'partly_allowed', 'dismissed', 'remanded', 'disposed'] as const;
const MAX_QUERY_CHARS = 4000;

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'was',
  'were',
  'that',
  'this',
  'from',
  'had',
  'has',
  'not',
  'but',
  'are',
  'his',
  'her',
  'its',
  'who',
  'whom',
  'any',
  'all',
  'case',
  'cases',
  'where',
  'when',
  'which',
  'while',
  'into',
  'than',
  'then',
  'over',
  'under',
  'upon',
  'also',
  'such',
  'been',
  'being',
  'have',
  'does',
  'did',
  'will',
  'shall',
  'may',
  'can',
  'judgment',
  'judgments',
  'court',
  'about',
  'involving',
  'regarding',
  'find',
  'show',
  'give',
  'need',
  'looking',
]);

/** The words of `text` worth searching for: no short or function words, once each, in order. */
export function searchTerms(text: string, limit = 24): string[] {
  const seen = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (word.length < 3 || STOP.has(word) || !/^[a-z0-9]+$/.test(word)) continue;
    seen.add(word);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** Phrases that name a subject area in an advocate's words (lower case, whole words). */
const SUBJECT_CUES: Readonly<Record<SubjectArea, readonly string[]>> = {
  medical_negligence: [
    'medical negligence',
    'negligence by doctor',
    'hospital negligence',
    'surgery',
    'post-operative',
    'postoperative',
    'informed consent',
  ],
  consumer: ['consumer', 'deficiency in service', 'consumer protection'],
  rent_control: ['rent control', 'eviction of tenant', 'tenant', 'landlord'],
  motor_accident_claims: ['motor accident', 'accident claim', 'mact', 'motor vehicles act'],
  ndps: ['ndps', 'narcotic', 'psychotropic', 'ganja', 'commercial quantity'],
  bail: ['bail', 'anticipatory bail', 'regular bail'],
  arbitration: ['arbitration', 'arbitral'],
  ibc: ['insolvency', 'ibc', 'corporate debtor', 'resolution professional'],
  service: ['service matter', 'dismissal from service', 'promotion', 'seniority', 'pension'],
  criminal_appeal: ['criminal appeal', 'conviction', 'acquittal'],
  cheque_dishonour: ['cheque', 'dishonour', 'section 138', 'negotiable instruments'],
  land_acquisition: ['land acquisition', 'compensation for land', 'acquired land'],
  family_matrimonial: ['divorce', 'maintenance', 'custody', 'matrimonial', 'domestic violence'],
  property_title: ['title suit', 'partition', 'sale deed', 'adverse possession', 'property title'],
  tax: ['income tax', 'gst', 'assessment order', 'customs duty'],
  labour_industrial: ['industrial dispute', 'workman', 'retrenchment', 'labour court'],
  constitutional_writ: ['writ petition', 'article 226', 'article 32', 'fundamental right'],
  company: ['company law', 'oppression and mismanagement', 'winding up', 'director'],
  intellectual_property: ['trademark', 'patent', 'copyright', 'passing off'],
  environment: ['pollution', 'environment', 'forest clearance'],
};

/** `IPC 304A`, `BNS s.106`, `NDPS section 37`: the statute written before the section. */
const STATUTE_FIRST =
  /\b(ipc|bns|bnss|crpc|cr\.?\s?p\.?\s?c|iea|bsa|ndps|cpc)\s*(?:act\s*)?(?:,?\s*(?:sections?|secs?\.?|ss?\.))?\s*(\d+[a-z]{0,2})\b/gi;

function ruleStatutes(query: string): StatuteSection[] {
  const found = new Map<string, StatuteSection>();
  const add = (statute: string, section: string): void => {
    const ref = { statute: canonicalStatute(statute), section: normaliseSection(section) };
    if (ref.section !== '') found.set(`${ref.statute}|${ref.section}`, ref);
  };
  for (const ref of extractStatuteRefs([{ pageNo: 1, text: query }])) add(ref.statute, ref.section);
  for (const m of query.matchAll(STATUTE_FIRST))
    add((m[1] ?? '').replace(/[.\s]/g, ''), m[2] ?? '');
  return [...found.values()];
}

function ruleCourtLevel(text: string): CourtLevel | null {
  if (/\b(supreme court|apex court)\b/.test(text)) return 'supreme_court';
  if (/\bhigh courts?\b/.test(text)) return 'high_court';
  return null;
}

/** The plan the rules alone produce: statutes, subject areas and court level the query names. */
export function heuristicPlan(query: string): ResearchPlan {
  const text = query.slice(0, MAX_QUERY_CHARS);
  const lower = text.toLowerCase();
  const subjectAreas = SUBJECT_AREAS.filter((area) =>
    SUBJECT_CUES[area].some((cue) =>
      new RegExp(`\\b${cue.replace(/[-\s]/g, '[-\\s]')}\\b`).test(lower),
    ),
  ).slice(0, 3);
  return {
    query: text,
    factDescription: text,
    keywords: searchTerms(text),
    subjectAreas,
    statutes: ruleStatutes(text),
    courts: [],
    courtLevel: ruleCourtLevel(lower),
    dateFrom: null,
    dateTo: null,
    outcome: null,
    offenceDate: null,
    planner: 'heuristic',
  };
}

/** The schema of the planner's reply, checked here on top of the gateway's own validation. */
export const planReplySchema = z.object({
  factDescription: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  subjectAreas: z.array(z.string()).optional(),
  statutes: z.array(z.object({ statute: z.string(), section: z.string() })).optional(),
  courts: z.array(z.string()).optional(),
  courtLevel: z.string().nullable().optional(),
  dateFrom: z.string().nullable().optional(),
  dateTo: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  offenceDate: z.string().nullable().optional(),
});

/** A real calendar date (`2024-02-30` is not one: it would roll over to March). */
const validDate = (value: string | null | undefined): string | null => {
  if (value == null || !ISO_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : null;
};

const unique = <T>(items: readonly T[], key: (item: T) => string): T[] => [
  ...new Map(items.map((item) => [key(item), item])).values(),
];

/** A fact description short enough to add nothing (the mock's `mock`, a one-word echo) is not used. */
const MIN_FACT_WORDS = 4;

/**
 * Merges a planner reply over the rule-based plan. Anything that is not in the vocabulary is
 * dropped; an unusable reply (`null`) leaves the rules' plan as it is.
 */
export function normalisePlan(query: string, reply: unknown): ResearchPlan {
  const base = heuristicPlan(query);
  const parsed = planReplySchema.safeParse(reply);
  if (!parsed.success) return base;
  const r = parsed.data;
  const known = new Set<string>(SUBJECT_AREAS);
  const subjectAreas = unique(
    [...base.subjectAreas, ...(r.subjectAreas ?? []).filter((a) => known.has(a))] as SubjectArea[],
    (a) => a,
  ).slice(0, 5);
  const statutes = unique(
    [
      ...base.statutes,
      ...(r.statutes ?? [])
        .map((s) => ({
          statute: canonicalStatute(s.statute),
          section: normaliseSection(s.section),
        }))
        .filter((s) => s.statute !== '' && s.section !== ''),
    ],
    (s) => `${s.statute}|${s.section}`,
  ).slice(0, 12);
  const level = COURT_LEVELS.find((l) => l === r.courtLevel) ?? null;
  const outcome = OUTCOMES.find((o) => o === r.outcome) ?? null;
  const facts = (r.factDescription ?? '').trim();
  const dateFrom = validDate(r.dateFrom);
  const dateTo = validDate(r.dateTo);
  return {
    ...base,
    factDescription:
      facts.split(/\s+/).length >= MIN_FACT_WORDS ? facts.slice(0, 1500) : base.factDescription,
    keywords: unique(
      [...base.keywords, ...(r.keywords ?? []).flatMap((k) => searchTerms(k))],
      (k) => k,
    ).slice(0, 24),
    subjectAreas,
    statutes,
    courts: unique(
      (r.courts ?? []).map((c) => c.trim().toUpperCase()).filter((c) => COURT_CODE.test(c)),
      (c) => c,
    ).slice(0, 6),
    courtLevel: base.courtLevel ?? level,
    // An inverted range is a planner slip, not a filter that matches nothing.
    dateFrom: dateFrom !== null && dateTo !== null && dateFrom > dateTo ? null : dateFrom,
    dateTo: dateFrom !== null && dateTo !== null && dateFrom > dateTo ? null : dateTo,
    outcome,
    offenceDate: validDate(r.offenceDate),
    planner: 'gateway',
  };
}

/** Asks the planner model; returns whatever it replied (validated by `normalisePlan`). */
export type PlanResolver = (query: string) => Promise<unknown>;

export interface GatewayPlanOptions {
  gateway: AiGateway;
  /** The platform scope; the corpus is global and the tenant is metered on its own usage key. */
  scope: Pick<RunContext, 'workspaceId'>;
}

export function createGatewayPlanResolver(options: GatewayPlanOptions): PlanResolver {
  return async (query) => {
    const result = await options.gateway.run(
      'plan_research_query',
      { query: query.slice(0, MAX_QUERY_CHARS) },
      { ...options.scope, purpose: 'research.plan' },
    );
    return result.output;
  };
}

/**
 * Plans `query`. A planner that fails (budget, residency, provider, invalid reply) leaves the rules'
 * plan: search still runs, only the model's extra filters are missing.
 */
export async function planQuery(query: string, resolver?: PlanResolver): Promise<ResearchPlan> {
  const text = query.trim().slice(0, MAX_QUERY_CHARS);
  if (resolver === undefined) return heuristicPlan(text);
  try {
    return normalisePlan(text, await resolver(text));
  } catch {
    return heuristicPlan(text);
  }
}

export interface StatuteChip extends StatuteSection {
  /** The counterparts in the other code (IPC 304A for BNS 106), with whether each governs the offence date. */
  counterparts: Equivalent[];
}

/** The statute chips of a plan with their IPC/BNS, CrPC/BNSS and IEA/BSA counterparts. */
export function statuteChips(plan: ResearchPlan): StatuteChip[] {
  return plan.statutes.map((s) => ({ ...s, counterparts: equivalents(s, plan.offenceDate) }));
}

/** Every statute and section key retrieval filters on: each statute and its counterparts. */
export function expandedStatutes(plan: ResearchPlan): StatuteSection[] {
  return unique(
    plan.statutes.flatMap((s) => facetKeys(s)),
    (s) => `${s.statute}|${s.section}`,
  );
}

const editedPlanSchema = z.object({
  query: z.string().trim().min(1).max(MAX_QUERY_CHARS),
  factDescription: z.string().trim().max(1500),
  keywords: z.array(z.string().min(1).max(80)).max(24),
  subjectAreas: z.array(z.enum(SUBJECT_AREAS)).max(5),
  statutes: z
    .array(z.object({ statute: z.string().min(1).max(200), section: z.string().min(1).max(50) }))
    .max(12),
  courts: z.array(z.string().regex(COURT_CODE)).max(6),
  courtLevel: z.enum(['supreme_court', 'high_court', 'other']).nullable(),
  dateFrom: z.string().regex(ISO_DATE).nullable(),
  dateTo: z.string().regex(ISO_DATE).nullable(),
  outcome: z.enum(OUTCOMES).nullable(),
  offenceDate: z.string().regex(ISO_DATE).nullable(),
  planner: z.enum(['gateway', 'heuristic']),
});

/**
 * An edited plan coming back from the filter chips (the browser can send anything): strictly
 * validated against the vocabularies and canonicalised, never merged with the rules, so a chip the
 * advocate removed stays removed. Null when it does not validate.
 */
export function validatePlan(raw: unknown): ResearchPlan | null {
  const parsed = editedPlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const dates = [p.dateFrom, p.dateTo, p.offenceDate];
  if (dates.some((d) => d !== null && validDate(d) === null)) return null;
  if (p.dateFrom !== null && p.dateTo !== null && p.dateFrom > p.dateTo) return null;
  return {
    ...p,
    factDescription: p.factDescription === '' ? p.query : p.factDescription,
    keywords: unique(
      p.keywords.flatMap((k) => searchTerms(k)),
      (k) => k,
    ),
    statutes: unique(
      p.statutes
        .map((s) => ({
          statute: canonicalStatute(s.statute),
          section: normaliseSection(s.section),
        }))
        .filter((s) => s.statute !== '' && s.section !== ''),
      (s) => `${s.statute}|${s.section}`,
    ),
  };
}
