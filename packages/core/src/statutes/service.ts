// The statutes domain (#1125, part 3 of #1116; D-053, D-001 amended / ADR 0051): a section's text in
// force on a date, its version history, a search over headings and the judgments that cite it.
// - Every export takes the caller's workspace and asserts membership first (workspaces), although
//   what it reads is global: `statute_act`, `statute_section`, `statute_section_version` (#1123,
//   SELECT only for the app role) and the anonymised corpus (`judgment`, `judgment_statute_ref`).
// - The IPC/BNS, CrPC/BNSS and IEA/BSA correspondence comes from `CODE_MAP` alone, through
//   `counterpart` of `@causedeck/intelligence`; nothing here stores or guesses a counterpart.
// - Judgments are served with `case_title` (the masked form when `title_masked`) and only once the
//   masking pass ran (`redaction_version > 0`); page text is never read here.
// - Nothing is written: no audit event and no log line carries section text, a query or a judgment.
import { isRole } from '@causedeck/auth';
import { currentScope, isUuid, schema, withWorkspace, type Queryable } from '@causedeck/db';
import {
  counterpart,
  sectionAt,
  sectionHistory,
  sectionKey,
  statuteKey,
  type CounterpartResult,
} from '@causedeck/intelligence';
import { and, asc, eq, or, sql } from 'drizzle-orm';

import { forbidden, invalid } from '../shared/errors.ts';
import { memberRole } from '../workspaces/index.ts';

const { statuteAct, statuteSection, statuteSectionVersion } = schema;

/** The longest section search query accepted, in characters. */
export const STATUTE_QUERY_MAX_CHARS = 200;
/** The most rows a search or an authorities list returns. */
export const STATUTE_RESULT_MAX = 50;

const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_AUTHORITIES_LIMIT = 10;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface StatutesActor {
  workspaceId: string;
  userId: string;
}

export interface SectionRef {
  /** Any spelling `normaliseStatute` reads (`IPC`, `Indian Penal Code`). */
  statute: string;
  /** Any spelling `normaliseSection` reads (`304A`, `Section 304 A`). */
  section: string;
}

export interface StatuteActView {
  key: string;
  title: string;
  shortName: string | null;
  sourceNote: string;
  synthetic: boolean;
}

export interface SectionVersionView {
  text: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  validFrom: string;
  /** ISO `YYYY-MM-DD`, exclusive; null while in force. */
  validTo: string | null;
  amendedBy: string | null;
  sourceNote: string;
  synthetic: boolean;
}

export interface SectionView {
  act: StatuteActView;
  section: string;
  heading: string;
  /** The version in force on the requested date; null when none covers it. */
  version: SectionVersionView | null;
  /** The counterpart in the other code from `CODE_MAP`, or "no counterpart recorded". */
  counterpart: CounterpartResult;
}

export interface SectionHistoryView {
  /** The act key (`indian penal code`). */
  statute: string;
  act: StatuteActView;
  section: string;
  heading: string;
  /** Oldest first. */
  versions: SectionVersionView[];
}

export interface SectionHit {
  statute: string;
  shortName: string | null;
  actTitle: string;
  section: string;
  heading: string;
}

export interface SectionAuthority {
  judgmentId: string;
  /** `judgment.case_title`: already the masked form when `titleMasked` (D-053). */
  title: string | null;
  titleMasked: boolean;
  neutralCitation: string | null;
  court: string;
  courtLevel: string | null;
  judgmentDate: string | null;
  /** The first page the judgment cites the section (or its counterpart) on. */
  page: number;
  /** The corpus record's source URL (`judgment.provenance->>'url'`); link it with `#page=<page>`. */
  sourceUrl: string | null;
  citedStatute: string;
  citedSection: string;
  citedByCount: number;
}

async function asMember<T>(db: Queryable, actor: StatutesActor, fn: () => Promise<T>): Promise<T> {
  const message = 'You cannot read statutes here';
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw forbidden(message);
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw forbidden(message);
  }
  const role = await withWorkspace(db, { workspaceId, userId }, (tx) =>
    memberRole(tx, userId, workspaceId),
  );
  if (role === null || !isRole(role)) throw forbidden(message);
  return fn();
}

/** Today in India as `YYYY-MM-DD`. */
function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function keysOf(ref: SectionRef): { statute: string; section: string } {
  const statute = typeof ref.statute === 'string' ? statuteKey(ref.statute) : '';
  const section = typeof ref.section === 'string' ? sectionKey(ref.section) : '';
  if (statute === '' || section === '') throw invalid('Name an act and a section');
  return { statute, section };
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1) throw invalid('The limit must be a positive integer');
  return Math.min(limit, STATUTE_RESULT_MAX);
}

interface LoadedSection {
  act: StatuteActView;
  section: string;
  heading: string;
  versions: (SectionVersionView & { valid_from: string; valid_to: string | null })[];
}

async function loadSection(
  db: Queryable,
  keys: { statute: string; section: string },
): Promise<LoadedSection | null> {
  const [head] = await db
    .select({
      id: statuteSection.id,
      section: statuteSection.section,
      heading: statuteSection.heading,
      key: statuteAct.key,
      title: statuteAct.title,
      shortName: statuteAct.shortName,
      sourceNote: statuteAct.sourceNote,
      synthetic: statuteAct.synthetic,
    })
    .from(statuteSection)
    .innerJoin(statuteAct, eq(statuteAct.id, statuteSection.actId))
    .where(and(eq(statuteAct.key, keys.statute), eq(statuteSection.section, keys.section)))
    .limit(1);
  if (head === undefined) return null;
  const rows = await db
    .select({
      text: statuteSectionVersion.text,
      validFrom: statuteSectionVersion.validFrom,
      validTo: statuteSectionVersion.validTo,
      amendedBy: statuteSectionVersion.amendedBy,
      sourceNote: statuteSectionVersion.sourceNote,
      synthetic: statuteSectionVersion.synthetic,
    })
    .from(statuteSectionVersion)
    .where(eq(statuteSectionVersion.sectionId, head.id))
    .orderBy(asc(statuteSectionVersion.validFrom));
  return {
    act: {
      key: head.key,
      title: head.title,
      shortName: head.shortName,
      sourceNote: head.sourceNote,
      synthetic: head.synthetic,
    },
    section: head.section,
    heading: head.heading,
    versions: rows.map((r) => ({ ...r, valid_from: r.validFrom, valid_to: r.validTo })),
  };
}

const toView = ({
  text,
  validFrom,
  validTo,
  amendedBy,
  sourceNote,
  synthetic,
}: SectionVersionView): SectionVersionView => ({
  text,
  validFrom,
  validTo,
  amendedBy,
  sourceNote,
  synthetic,
});

/**
 * A section's text in force on `onDate` (default: today in India), its heading, the act it belongs
 * to and its counterpart in the other code. Null when the act or the section is not stored.
 */
export async function getSection(
  db: Queryable,
  actor: StatutesActor,
  input: SectionRef & { onDate?: string },
): Promise<SectionView | null> {
  return asMember(db, actor, async () => {
    const keys = keysOf(input);
    if (input.onDate !== undefined && !ISO_DATE.test(input.onDate)) {
      throw invalid('The date must be YYYY-MM-DD');
    }
    const onDate = input.onDate ?? todayIst();
    const loaded = await loadSection(db, keys);
    if (loaded === null) return null;
    const inForce = sectionAt(loaded.versions, onDate);
    return {
      act: loaded.act,
      section: loaded.section,
      heading: loaded.heading,
      version: inForce === null ? null : toView(inForce),
      counterpart: counterpart(keys.statute, keys.section, onDate),
    };
  });
}

/** The act and heading of a stored section, for a citation check; no text. */
export interface SectionRefMatch {
  act: { key: string; title: string; shortName: string | null };
  section: string;
  heading: string;
}

/**
 * System-safe section lookup for the citation check (#1135): the same `loadSection` path as
 * `getSection`, without an actor, because the drafting check also runs as a job's system actor.
 * The tables are global and public law; nothing is audited or logged and no section text returns.
 * Null when the act or section is not stored, or the reference cannot be read.
 */
export async function resolveSectionRef(
  ref: SectionRef,
  { db }: { db: Queryable },
): Promise<SectionRefMatch | null> {
  let keys: { statute: string; section: string };
  try {
    keys = keysOf(ref);
  } catch {
    return null;
  }
  const loaded = await loadSection(db, keys);
  if (loaded === null) return null;
  const { key, title, shortName } = loaded.act;
  return { act: { key, title, shortName }, section: loaded.section, heading: loaded.heading };
}

/** Every version of a section, oldest first, with its validity range. Null when not stored. */
export async function listSectionHistory(
  db: Queryable,
  actor: StatutesActor,
  input: SectionRef,
): Promise<SectionHistoryView | null> {
  return asMember(db, actor, async () => {
    const loaded = await loadSection(db, keysOf(input));
    if (loaded === null) return null;
    return {
      statute: loaded.act.key,
      act: loaded.act,
      section: loaded.section,
      heading: loaded.heading,
      versions: sectionHistory(loaded.versions).versions.map(toView),
    };
  });
}

/** Sections whose number or heading matches `query`, ordered by act and section. */
export async function searchSections(
  db: Queryable,
  actor: StatutesActor,
  input: { query: string; limit?: number },
): Promise<SectionHit[]> {
  return asMember(db, actor, async () => {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (query.length === 0 || query.length > STATUTE_QUERY_MAX_CHARS) {
      throw invalid(`Search with 1 to ${String(STATUTE_QUERY_MAX_CHARS)} characters`);
    }
    const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT);
    const asSection = sectionKey(query);
    return db
      .select({
        statute: statuteAct.key,
        shortName: statuteAct.shortName,
        actTitle: statuteAct.title,
        section: statuteSection.section,
        heading: statuteSection.heading,
      })
      .from(statuteSection)
      .innerJoin(statuteAct, eq(statuteAct.id, statuteSection.actId))
      .where(
        or(
          sql`${statuteSection.searchTsv} @@ plainto_tsquery('simple', ${query})`,
          asSection === '' ? undefined : eq(statuteSection.section, asSection),
        ),
      )
      .orderBy(asc(statuteAct.key), asc(statuteSection.section))
      .limit(limit);
  });
}

type AuthorityRow = Omit<SectionAuthority, 'citedByCount' | 'page'> & {
  citedByCount: number | string;
  page: number | string;
};

/**
 * The judgments that cite the section or its `CODE_MAP` counterpart, with the page of the citation:
 * Supreme Court first, then High Courts, then the most cited. An empty list is a valid answer.
 */
export async function topAuthoritiesForSection(
  db: Queryable,
  actor: StatutesActor,
  input: SectionRef & { limit?: number },
): Promise<SectionAuthority[]> {
  return asMember(db, actor, async () => {
    const keys = keysOf(input);
    const limit = clampLimit(input.limit, DEFAULT_AUTHORITIES_LIMIT);
    const mapped = counterpart(keys.statute, keys.section);
    const refs = [
      keys,
      ...(mapped.kind === 'recorded'
        ? mapped.counterparts.map((c) => ({ statute: c.statute, section: c.section }))
        : []),
    ];
    const matches = sql.join(
      refs.map(
        (r) =>
          sql`(r.statute = ${r.statute} and (r.section = ${r.section} or r.section like ${`${r.section}(%`}))`,
      ),
      sql` or `,
    );
    // nosemgrep: infra.security.semgrep.causedeck.raw-sql-bypasses-with-workspace -- judgment, judgment_statute_ref and judgment_citation_ref are global corpus tables (no workspace_id, no RLS); public anonymised judgments only
    const rows = await db.execute(sql`
      select * from (
        select distinct on (j.id)
          j.id as "judgmentId", j.case_title as title, j.title_masked as "titleMasked",
          j.neutral_citation as "neutralCitation", j.court as court, j.court_level as "courtLevel",
          j.judgment_date::text as "judgmentDate", r.page as page,
          j.provenance->>'url' as "sourceUrl",
          r.statute as "citedStatute", r.section as "citedSection",
          (select count(distinct cr.judgment_id)::int from judgment_citation_ref cr
            where cr.cited_judgment_id = j.id) as "citedByCount"
        from judgment_statute_ref r
        join judgment j on j.id = r.judgment_id
        where j.redaction_version > 0 and (${matches})
        order by j.id, r.page, r.statute, r.section
      ) a
      order by case a."courtLevel" when 'supreme_court' then 0 when 'high_court' then 1
          when 'other' then 2 else 3 end,
        a."citedByCount" desc, a."judgmentDate" desc nulls last, a."judgmentId"
      limit ${limit}`);
    return Array.from(rows as unknown as AuthorityRow[]).map((row) => ({
      ...row,
      page: Number(row.page),
      citedByCount: Number(row.citedByCount),
    }));
  });
}
