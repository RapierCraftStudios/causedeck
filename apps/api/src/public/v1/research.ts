// `GET /v1/research/search?q` (#896, ADR 0051): fact-pattern search over the anonymised judgment
// corpus. The description of the facts is planned, retrieved lexically and by vector, fused, reranked
// and grouped by judgment; each result carries the matching passages with their roles and pages. The
// response is redacted data only (D-053): passages are `judgment_segment.text`, titles are the stored
// masked form, and no source name, fetch route, licence, judge rating or prediction is returned.
// Scope `research:read`. A search counts as one `research.searches` unit of the workspace (the plan's
// monthly cap answers 429) on top of the key's own call quota.
import { searchAuthorities, RESEARCH_QUERY_MAX_CHARS } from '@causedeck/core/research';
import { WorkspaceError } from '@causedeck/core/workspaces';
import type { Database } from '@causedeck/db';
import { z } from '@hono/zod-openapi';

import { ApiError, ForbiddenError, ValidationError } from '../../errors.ts';
import {
  createRouter,
  defineRoute,
  problemResponses,
  requireScope,
  type AppRouter,
} from '../../lib/openapi.ts';

import { actorOf, publicWorkspace } from './schemas.ts';

const SegmentSchema = z.object({
  id: z.string(),
  role: z.string(),
  page_from: z.number().int(),
  page_to: z.number().int(),
  text: z.string(),
  score: z.number(),
});

const ResultSchema = z.object({
  id: z.string(),
  court: z.string(),
  court_level: z.string().nullable(),
  date: z.string().nullable(),
  neutral_citation: z.string().nullable(),
  title: z.string().nullable(),
  title_masked: z.boolean(),
  outcome: z.string(),
  cited_by: z.number().int(),
  official_url: z.string().nullable(),
  score: z.number(),
  segments: z.array(SegmentSchema),
});

const FiltersSchema = z.object({
  subject_areas: z.array(z.string()),
  statutes: z.array(z.object({ statute: z.string(), section: z.string() })),
  courts: z.array(z.string()),
  court_level: z.string().nullable(),
  date_from: z.string().nullable(),
  date_to: z.string().nullable(),
  outcome: z.string().nullable(),
});

export function searchResearchRoute(db: Database) {
  // authz: public — scope `research:read` (API keys); the caller's own workspace; reads global anonymised corpus data only.
  return defineRoute({
    method: 'get',
    path: '/research/search',
    operationId: 'searchPublicResearch',
    tags: ['Public API'],
    summary: 'Fact-pattern search over anonymised judgments, grouped by judgment',
    middleware: [requireScope('research:read'), publicWorkspace(db)],
    request: {
      query: z.object({ q: z.string().trim().min(1).max(RESEARCH_QUERY_MAX_CHARS) }),
    },
    responses: {
      200: {
        description:
          'Judgments with their matching passages, best first; empty when nothing matches',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(ResultSchema), filters: FiltersSchema }),
          },
        },
      },
      ...problemResponses(401, 403, 422, 429),
    },
  });
}

/** A domain refusal as the API error it is; anything else stays unexpected. */
function toApiError(error: unknown): unknown {
  if (!(error instanceof WorkspaceError)) return error;
  if (error.code === 'RATE_LIMITED') return new ApiError(429, 'RATE_LIMITED', error.message);
  if (error.code === 'FORBIDDEN') return new ForbiddenError();
  if (error.code === 'VALIDATION') {
    return new ValidationError([{ path: 'query.q', message: error.message }]);
  }
  return error;
}

export function researchRouter(db: Database): AppRouter {
  return createRouter().openapi(searchResearchRoute(db), async (c) => {
    const { q } = c.req.valid('query');
    let result;
    try {
      result = await searchAuthorities(db, actorOf(c), { query: q, requestId: c.get('requestId') });
    } catch (error) {
      throw toApiError(error);
    }
    return c.json(
      {
        data: result.hits.map((h) => ({
          id: h.judgmentId,
          court: h.court,
          court_level: h.courtLevel,
          date: h.judgmentDate,
          neutral_citation: h.neutralCitation,
          title: h.title,
          title_masked: h.titleMasked,
          outcome: h.outcome,
          cited_by: h.citedByCount,
          official_url: h.sourceUrl,
          score: h.score,
          segments: h.segments.map((s) => ({
            id: s.segmentId,
            role: s.role,
            page_from: s.pageFrom,
            page_to: s.pageTo,
            text: s.text,
            score: s.score,
          })),
        })),
        filters: {
          subject_areas: result.plan.subjectAreas,
          statutes: result.plan.statutes,
          courts: result.plan.courts,
          court_level: result.plan.courtLevel,
          date_from: result.plan.dateFrom,
          date_to: result.plan.dateTo,
          outcome: result.plan.outcome,
        },
      },
      200,
    );
  });
}
