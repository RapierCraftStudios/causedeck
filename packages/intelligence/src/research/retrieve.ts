// The two retrieval arms (#896, ADR 0051 §Query pipeline step 2): a lexical top-N over
// `judgment_segment.search_tsv` and a vector top-N over `judgment_segment.embedding`, both filtered by
// the plan's facets in the same statement and each one round trip. Rows come from `judgment_segment.text`
// (the anonymised text) joined to judgment metadata; `judgment.page_text` is never selected (D-053).
// Segments count only while they were built from the judgment's current redaction, and vectors only
// while they came from the model version being queried (vectors of two models are never compared).
// The tables are global (no workspace_id, no RLS) and hold public judgments, so the statements run on
// the caller's handle, which may be a workspace transaction.
import type { Queryable } from '@causedeck/db';
import { sql, type SQL } from 'drizzle-orm';

import { expandedStatutes, searchTerms } from './plan.ts';
import type {
  RankedCandidates,
  ResearchPlan,
  SegmentCandidate,
  SegmentRetriever,
} from './types.ts';

/** Candidates each arm returns (ADR 0051). */
export const ARM_LIMIT = 200;

const list = (values: readonly string[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** The facet filter of `plan` over `s` (segment) and `j` (judgment), as SQL conditions. */
export function planFilters(plan: ResearchPlan): SQL[] {
  const filters: SQL[] = [
    sql`j.redaction_version > 0`,
    sql`j.segmented_redaction_version = j.redaction_version`,
  ];
  if (plan.courts.length > 0) filters.push(sql`s.court in (${list(plan.courts)})`);
  if (plan.courtLevel !== null) filters.push(sql`s.court_level = ${plan.courtLevel}`);
  if (plan.dateFrom !== null) {
    filters.push(sql`s.judgment_year >= ${Number(plan.dateFrom.slice(0, 4))}`);
    filters.push(sql`j.judgment_date >= ${plan.dateFrom}::date`);
  }
  if (plan.dateTo !== null) {
    filters.push(sql`s.judgment_year <= ${Number(plan.dateTo.slice(0, 4))}`);
    filters.push(sql`j.judgment_date <= ${plan.dateTo}::date`);
  }
  if (plan.outcome !== null) filters.push(sql`j.outcome = ${plan.outcome}`);
  // Bench strength is the number of justices the header named; a judgment with none is unknown and
  // only drops out when a bench filter is set (#1174).
  if (plan.benchMin != null) filters.push(sql`cardinality(j.bench) >= ${plan.benchMin}`);
  if (plan.benchMax != null) {
    filters.push(sql`cardinality(j.bench) between 1 and ${plan.benchMax}`);
  }
  if (plan.subjectAreas.length > 0) {
    // Subject tags come only from the model tagger (#1182): a judgment nobody has tagged yet is not
    // excluded, a judgment tagged with another subject is.
    filters.push(sql`(exists (
      select 1 from judgment_tag t
      where t.judgment_id = j.id and t.subject_area in (${list(plan.subjectAreas)}))
      or not exists (select 1 from judgment_tag t2 where t2.judgment_id = j.id))`);
  }
  const statutes = expandedStatutes(plan);
  if (statutes.length > 0) {
    const any = sql.join(
      statutes.map(
        (st) =>
          sql`(r.statute = ${st.statute} and (r.section = ${st.section} or r.section like ${`${st.section}(%`}))`,
      ),
      sql` or `,
    );
    filters.push(sql`exists (
      select 1 from judgment_statute_ref r where r.judgment_id = j.id and (${any}))`);
  }
  return filters;
}

/**
 * The full-text query of `plan`'s lexical arm: its search terms OR'd (`a | b | c`), never AND'd, so a
 * passage matching some words of a sentence still ranks. The arm orders by how many distinct query
 * lexemes (stems) a segment holds, then `ts_rank_cd`, then id (#1187). Empty when there are no terms.
 */
export function lexicalQueryText(plan: Pick<ResearchPlan, 'keywords' | 'query'>): string {
  return searchTerms([plan.keywords.join(' '), plan.query].join(' ')).join(' | ');
}

/** Terms that take part in the minimum-match levels; the rest still count for coverage and rank. */
export const MIN_MATCH_TERMS = 8;

/**
 * A full-text query matching segments that hold at least `k` of `terms` (the first `MIN_MATCH_TERMS`):
 * the OR of every `k`-term AND. `k <= 1` is the plain OR of all terms.
 */
export function minMatchQuery(terms: readonly string[], k: number): string {
  const unique = [...new Set(terms)];
  if (k <= 1 || unique.length <= 1) return unique.join(' | ');
  const pool = unique.slice(0, MIN_MATCH_TERMS);
  const size = Math.min(k, pool.length);
  const clauses: string[] = [];
  const pick = (start: number, chosen: string[]): void => {
    if (chosen.length === size) {
      clauses.push(`(${chosen.join(' & ')})`);
      return;
    }
    for (let i = start; i < pool.length; i += 1) pick(i + 1, [...chosen, pool[i] ?? '']);
  };
  pick(0, []);
  return clauses.join(' | ');
}

/**
 * The minimum-match levels the lexical arm tries, strictest first. The plain OR (level 1) is only a
 * last resort for three or more terms: on a large corpus common words match tens of thousands of
 * segments, and ranking all of them takes tens of seconds.
 */
export function minMatchLevels(termCount: number): number[] {
  if (termCount <= 1) return [1];
  if (termCount === 2) return [2, 1];
  return [3, 2, 1];
}

/** Rows a level must return before the arm stops relaxing it. */
export const MIN_MATCH_ENOUGH = 20;

const SELECT = sql`
  select s.id as "segmentId", s.judgment_id as "judgmentId", s.judgment_year as "judgmentYear",
    s.ordinal as ordinal, s.role as role, s.page_from as "pageFrom", s.page_to as "pageTo",
    s.text as text, s.court as court, s.court_level as "courtLevel",
    j.case_title as title, j.title_masked as "titleMasked",
    j.neutral_citation as "neutralCitation", j.case_numbers as "caseNumbers",
    j.judgment_date::text as "judgmentDate", j.outcome as outcome, j.provenance->>'url' as "sourceUrl",
    nullif(cardinality(j.bench), 0) as "benchStrength",
    j.pinpoint_state as "pinpointState", j.attribution as attribution,
    (select count(distinct cr.judgment_id)::int from judgment_citation_ref cr
      where cr.cited_judgment_id = j.id) as "citedByCount"
  from judgment_segment s
  join judgment j on j.id = s.judgment_id`;

type Row = Omit<SegmentCandidate, 'citedByCount'> & { citedByCount: number | string };

const toCandidate = (row: Row): SegmentCandidate => ({
  ...row,
  citedByCount: Number(row.citedByCount),
});

/** The vector literal pgvector reads. */
const vectorLiteral = (embedding: readonly number[]): string => `[${embedding.join(',')}]`;

export interface DrizzleRetrieverOptions {
  /** The embedding model version the query vector comes from; only segments embedded by it are searched. */
  embeddingModel: string;
  /** Segments less similar than this (cosine) are not candidates; default `VECTOR_MIN_SIMILARITY`. */
  minSimilarity?: number;
}

/**
 * A nearest-neighbour search always returns neighbours, however far; this floor keeps an unrelated query
 * from matching the corpus. It is model-dependent and a starting value: the #891 evaluation sets it.
 */
export const VECTOR_MIN_SIMILARITY = 0.2;

export function drizzleRetriever(
  db: Queryable,
  options: DrizzleRetrieverOptions,
): SegmentRetriever {
  return {
    async lexical(plan, limit): Promise<RankedCandidates> {
      const text = lexicalQueryText(plan);
      if (text === '') return [];
      const terms = text.split(' | ');
      const filters = sql.join(planFilters(plan), sql` and `);
      // Index-first (#1187 follow-up): the GIN index finds the matching segments and ranks them in a
      // materialized CTE before any join, so the planner never walks judgments one by one through every
      // year partition (its estimate of the version filter is far too low). Coverage counts the distinct
      // query lexemes a segment holds; segment text is read only for the final `limit` rows.
      // Minimum match: segments must hold at least k query terms, relaxed level by level only while a
      // level returns too few rows. Coverage and rank always use every term.
      const run = async (match: string): Promise<Row[]> => {
        // nosemgrep: infra.security.semgrep.causedeck.raw-sql-bypasses-with-workspace -- judgment_segment and judgment are global corpus tables (no workspace_id, no RLS); public anonymised judgments only
        const rows = await db.execute(sql`with query as materialized (
            select to_tsquery('english', ${text}) as q, to_tsquery('english', ${match}) as m,
              array(select distinct unnest(tsvector_to_array(to_tsvector('english', ${text})))) as lexemes
          ),
          hits as materialized (
            select s.id, s.judgment_year, s.judgment_id, s.court, s.court_level,
              (select count(*) from unnest(query.lexemes) l
                where s.search_tsv @@ plainto_tsquery('simple', l))::int as coverage,
              ts_rank_cd(s.search_tsv, query.q) as rank
            from judgment_segment s, query
            where s.search_tsv @@ query.m
          ),
          top as (
            select s.id, s.judgment_year, s.coverage, s.rank
            from hits s join judgment j on j.id = s.judgment_id
            where ${filters}
            order by s.coverage desc, s.rank desc, s.id
            limit ${limit}
          )
          ${SELECT}
          join top t on t.id = s.id and t.judgment_year = s.judgment_year
          order by t.coverage desc, t.rank desc, s.id`);
        return Array.from(rows as unknown as Row[]);
      };
      const levels = minMatchLevels(terms.length);
      let rows: Row[] = [];
      for (const [i, k] of levels.entries()) {
        const last = i === levels.length - 1;
        // The plain OR runs only when the stricter levels found nothing at all.
        if (last && k === 1 && levels.length > 1 && rows.length > 0) break;
        rows = await run(minMatchQuery(terms, k));
        if (rows.length >= Math.min(limit, MIN_MATCH_ENOUGH)) break;
      }
      return rows.map(toCandidate);
    },
    async vector(embedding, plan, limit): Promise<RankedCandidates> {
      if (embedding.length === 0) return [];
      const filters = sql.join(planFilters(plan), sql` and `);
      const vec = vectorLiteral(embedding);
      const maxDistance = 1 - (options.minSimilarity ?? VECTOR_MIN_SIMILARITY);
      // nosemgrep: infra.security.semgrep.causedeck.raw-sql-bypasses-with-workspace -- judgment_segment and judgment are global corpus tables (no workspace_id, no RLS); public anonymised judgments only
      const rows = await db.execute(sql`${SELECT}
        where s.embedding is not null and s.embedding_model = ${options.embeddingModel}
          and s.embedding <=> ${vec}::halfvec <= ${maxDistance}
          and ${filters}
        order by s.embedding <=> ${vec}::halfvec, s.id
        limit ${limit}`);
      return Array.from(rows as unknown as Row[]).map(toCandidate);
    },
  };
}
