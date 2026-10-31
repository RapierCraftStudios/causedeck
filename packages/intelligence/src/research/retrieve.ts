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
  if (plan.subjectAreas.length > 0) {
    filters.push(sql`exists (
      select 1 from judgment_tag t
      where t.judgment_id = j.id and t.subject_area in (${list(plan.subjectAreas)}))`);
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

const SELECT = sql`
  select s.id as "segmentId", s.judgment_id as "judgmentId", s.judgment_year as "judgmentYear",
    s.ordinal as ordinal, s.role as role, s.page_from as "pageFrom", s.page_to as "pageTo",
    s.text as text, s.court as court, s.court_level as "courtLevel",
    j.case_title as title, j.title_masked as "titleMasked",
    j.neutral_citation as "neutralCitation", j.judgment_date::text as "judgmentDate",
    j.outcome as outcome, j.provenance->>'url' as "sourceUrl",
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
      const terms = searchTerms([plan.keywords.join(' '), plan.query].join(' '));
      if (terms.length === 0) return [];
      const filters = sql.join(planFilters(plan), sql` and `);
      // nosemgrep: infra.security.semgrep.causedeck.raw-sql-bypasses-with-workspace -- judgment_segment and judgment are global corpus tables (no workspace_id, no RLS); public anonymised judgments only
      const rows = await db.execute(sql`${SELECT}
        cross join (select to_tsquery('english', ${terms.join(' | ')}) as q) query
        where s.search_tsv @@ query.q and ${filters}
        order by ts_rank_cd(s.search_tsv, query.q) desc, s.id
        limit ${limit}`);
      return Array.from(rows as unknown as Row[]).map(toCandidate);
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
