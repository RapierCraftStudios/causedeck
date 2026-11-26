// The research query router (#1174, part 1 of #1170): what the advocate typed in the research box is a
// fact pattern, a citation (neutral citation, case number or CNR) or a statute section. A citation is
// resolved through the corpus resolver and a section through `resolveSectionRef` with its counterpart
// in the other code (`CODE_MAP`). Anything that does not resolve is searched as facts, so the router
// never refuses a query. Member-checked like the search; unmetered and unaudited, because it reads
// only global public tables (corpus and statutes) and spends nothing. No judgment text is returned:
// only ids, the stored (masked) title and the citation.
import { schema, type Queryable } from '@causedeck/db';
import { normalizeCitation, STRUCTURED_PATTERNS } from '@causedeck/drafting';
import { counterpart } from '@causedeck/intelligence';
import { inArray, sql } from 'drizzle-orm';

import { createCorpusResolver, verifyCitation } from '../citations/index.ts';
import { invalid } from '../shared/errors.ts';
import { resolveSectionRef } from '../statutes/index.ts';

import { asMember, RESEARCH_QUERY_MAX_CHARS, type ResearchSearchActor } from './search.ts';

const { judgment } = schema;

/** A query is a citation or section only when this many words, at most, are left around the match. */
const MAX_EXTRA_WORDS = 2;
/** Judgments one case number or CNR may name. */
const MAX_MATCHES = 5;

/** eCourts Case Number Record: state and district letters, establishment, number and year (16 chars). */
const CNR = /^[A-Z]{4}\d{12}$/;

/** `483 BNSS`, `BNSS 483`, `section 483 of the BNSS`: a bare section reference typed in the search box. */
const STATUTE_CODES = String.raw`BNSS|BNS|BSA|IPC|I\.?P\.?C\.?|CrPC|Cr\.?P\.?C\.?|CPC|C\.?P\.?C\.?|IEA|NDPS`;
const SECTION_NO = String.raw`\d{1,4}[A-Za-z]{0,2}(?:\([A-Za-z0-9]{1,4}\))*`;
const BARE_SECTION = [
  new RegExp(
    String.raw`^(?:(?:u\/s\.?|sec(?:tion)?s?\.?|ss?\.)\s*)?(?<sec>${SECTION_NO})\s+(?:of\s+(?:the\s+)?)?(?<statute>${STATUTE_CODES})$`,
    'i',
  ),
  new RegExp(
    String.raw`^(?<statute>${STATUTE_CODES})\s+(?:(?:u\/s\.?|sec(?:tion)?s?\.?|ss?\.)\s*)?(?<sec>${SECTION_NO})$`,
    'i',
  ),
];

export interface RoutedJudgment {
  judgmentId: string;
  /** `judgment.case_title`: already the masked form when `titleMasked` (D-053). */
  title: string | null;
  titleMasked: boolean;
  neutralCitation: string | null;
  court: string;
  judgmentDate: string | null;
  /** False until the judgment is redacted; the reader refuses it until then. */
  readable: boolean;
}

export interface RoutedSection {
  statute: string;
  section: string;
  actTitle: string;
  shortName: string | null;
  heading: string;
}

export type ResearchQueryRoute =
  | { kind: 'facts'; query: string }
  | {
      kind: 'citation';
      citationKind: 'neutral' | 'case_number' | 'cnr';
      /** The canonical form of the citation (CNR without hyphens). */
      normalized: string;
      judgments: RoutedJudgment[];
    }
  | {
      kind: 'section';
      section: RoutedSection;
      /** The stored counterparts in the other code (IPC/BNS, CrPC/BNSS, IEA/BSA); empty when none. */
      counterparts: RoutedSection[];
    };

export interface ClassifyResearchQueryInput {
  query: string;
}

const words = (text: string): number =>
  text
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '').length;

interface Detected {
  kind: 'neutral' | 'case_number' | 'section' | 'cnr';
  normalized: string;
  parts?: { statute: string; section: string };
}

/** The citation, CNR or section `query` consists of, or null when it is (also) a fact description. */
export function detectReference(query: string): Detected | null {
  const compactCnr = query.replace(/[\s-]/g, '').toUpperCase();
  if (CNR.test(compactCnr)) return { kind: 'cnr', normalized: compactCnr };
  for (const re of BARE_SECTION) {
    const m = re.exec(query.trim());
    const statute = m?.groups?.statute;
    const section = m?.groups?.sec;
    if (statute !== undefined && section !== undefined) {
      const code = statute.replace(/\./g, '').toUpperCase();
      return {
        kind: 'section',
        normalized: `${code} s ${section.toUpperCase()}`,
        parts: { statute: code, section: section.toUpperCase() },
      };
    }
  }
  for (const pattern of STRUCTURED_PATTERNS) {
    if (pattern.kind !== 'neutral' && pattern.kind !== 'case_number' && pattern.kind !== 'section')
      continue;
    const m = new RegExp(pattern.regex.source, pattern.regex.flags.replace('g', '')).exec(query);
    if (m === null) continue;
    const rest = query.slice(0, m.index) + query.slice(m.index + m[0].length);
    if (words(rest) > MAX_EXTRA_WORDS) continue;
    const normalized = pattern.normalize(m);
    if (normalized === '') continue;
    return {
      kind: pattern.kind,
      normalized,
      ...(pattern.parts === undefined ? {} : { parts: pattern.parts(m) }),
    };
  }
  return null;
}

async function judgmentsByIds(db: Queryable, ids: readonly string[]): Promise<RoutedJudgment[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      judgmentId: judgment.id,
      title: judgment.caseTitle,
      titleMasked: judgment.titleMasked,
      neutralCitation: judgment.neutralCitation,
      court: judgment.court,
      judgmentDate: judgment.judgmentDate,
      redactionVersion: judgment.redactionVersion,
    })
    .from(judgment)
    .where(inArray(judgment.id, [...ids]));
  return rows.map(({ redactionVersion, ...row }) => ({ ...row, readable: redactionVersion > 0 }));
}

/** Judgment ids whose printed case numbers match: by the drafting normal form, or the bare CNR. */
async function idsByCaseNumber(
  db: Queryable,
  kind: 'case_number' | 'cnr',
  normalized: string,
): Promise<string[]> {
  if (kind === 'cnr') {
    const rows = await db
      .select({ id: judgment.id })
      .from(judgment)
      .where(
        sql`exists (select 1 from unnest(${judgment.caseNumbers}) as n
          where upper(regexp_replace(n, '[^A-Za-z0-9]', '', 'g')) = ${normalized})`,
      )
      .limit(MAX_MATCHES);
    return rows.map((r) => r.id);
  }
  const parts = /^\S+ (?<no>\d+)\/(?<year>\d{4})$/.exec(normalized)?.groups;
  if (parts?.no === undefined || parts.year === undefined) return [];
  const pattern = `(^|[^0-9])0*${parts.no}\\s*(of|/)\\s*${parts.year}([^0-9]|$)`;
  const rows = await db
    .select({ id: judgment.id, caseNumbers: judgment.caseNumbers })
    .from(judgment)
    .where(sql`exists (select 1 from unnest(${judgment.caseNumbers}) as n where n ~* ${pattern})`)
    .limit(MAX_MATCHES * 4);
  return rows
    .filter((r) => r.caseNumbers.some((n) => normalizeCitation(n) === normalized))
    .slice(0, MAX_MATCHES)
    .map((r) => r.id);
}

async function routeSection(
  db: Queryable,
  parts: { statute: string; section: string },
): Promise<ResearchQueryRoute | null> {
  const found = await resolveSectionRef(parts, { db });
  if (found === null) return null;
  const toView = (f: NonNullable<typeof found>): RoutedSection => ({
    statute: f.act.key,
    section: f.section,
    actTitle: f.act.title,
    shortName: f.act.shortName,
    heading: f.heading,
  });
  const mapped = counterpart(found.act.key, found.section);
  const counterparts: RoutedSection[] = [];
  if (mapped.kind === 'recorded') {
    for (const c of mapped.counterparts) {
      const stored = await resolveSectionRef({ statute: c.statute, section: c.section }, { db });
      if (stored !== null) counterparts.push(toView(stored));
    }
  }
  return { kind: 'section', section: toView(found), counterparts };
}

/**
 * Classifies a research query: `section` when it names a stored statute section, `citation` when it
 * is a neutral citation, case number or CNR of a stored judgment, otherwise `facts`.
 */
export async function classifyResearchQuery(
  db: Queryable,
  actor: ResearchSearchActor,
  input: ClassifyResearchQueryInput,
): Promise<ResearchQueryRoute> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (query === '' || query.length > RESEARCH_QUERY_MAX_CHARS) {
    throw invalid(`Describe the facts in 1 to ${String(RESEARCH_QUERY_MAX_CHARS)} characters`);
  }
  return asMember(db, actor, async () => {
    const facts: ResearchQueryRoute = { kind: 'facts', query };
    const ref = detectReference(query);
    if (ref === null) return facts;
    if (ref.kind === 'section') {
      if (ref.parts === undefined) return facts;
      return (await routeSection(db, ref.parts)) ?? facts;
    }
    if (ref.kind === 'cnr') {
      const judgments = await judgmentsByIds(db, await idsByCaseNumber(db, 'cnr', ref.normalized));
      return judgments.length === 0
        ? facts
        : { kind: 'citation', citationKind: 'cnr', normalized: ref.normalized, judgments };
    }
    // The corpus resolver decides whether the citation is stored; only then are its ids read.
    const resolved = await createCorpusResolver({ db }).resolve({
      kind: ref.kind,
      normalized: ref.normalized,
    });
    if (resolved.kind !== 'hits' || resolved.hits.length === 0) return facts;
    let ids: string[] = [];
    if (ref.kind === 'neutral') {
      const verified = await verifyCitation(ref.normalized, { db });
      ids = verified.status === 'VERIFIED' ? [verified.judgmentId] : [];
    } else {
      ids = await idsByCaseNumber(db, 'case_number', ref.normalized);
    }
    const judgments = await judgmentsByIds(db, ids);
    return judgments.length === 0
      ? facts
      : { kind: 'citation', citationKind: ref.kind, normalized: ref.normalized, judgments };
  });
}
