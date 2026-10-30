// `GET /v1/cases/{cnr}` (#625): the latest status of one of the caller's own cases, from a cleared
// source, with `as_of` and `official_url`. Scope `cases:read`; 404 for a case that is not the
// workspace's (the same answer for another workspace's case).
import { getPublicCase } from '@causedeck/core/public-api';
import type { Database } from '@causedeck/db';
import { z } from '@hono/zod-openapi';

import { NotFoundError } from '../../errors.ts';
import {
  createRouter,
  defineRoute,
  problemResponses,
  requireScope,
  type AppRouter,
} from '../../lib/openapi.ts';

import { actorOf, publicWorkspace, recordOf, recordShape } from './schemas.ts';

export const OrderSchema = z.object({
  date: z.string().nullable(),
  number: z.string().nullable(),
  summary: z.string().nullable(),
  official_url: z.string().nullable(),
});

const CaseSchema = z.object({
  cnr: z.string(),
  status: z.string().nullable(),
  next_hearing_date: z.string().nullable(),
  last_hearing_date: z.string().nullable(),
  stage: z.string().nullable(),
  bench: z.string().nullable(),
  fetched_at: z.string(),
  orders: z.array(OrderSchema),
  ...recordShape,
});

export function getCaseRoute(db: Database) {
  // authz: public — scope `cases:read` (API keys); the caller's own workspace, own matters only.
  return defineRoute({
    method: 'get',
    path: '/cases/{cnr}',
    operationId: 'getPublicCase',
    tags: ['Public API'],
    summary: 'Latest status of one of the workspace’s own cases',
    middleware: [requireScope('cases:read'), publicWorkspace(db)],
    request: { params: z.object({ cnr: z.string().regex(/^[A-Z0-9]{16}$/) }) },
    responses: {
      200: {
        description: 'The case status',
        content: { 'application/json': { schema: CaseSchema } },
      },
      ...problemResponses(401, 403, 404, 422, 429),
    },
  });
}

export function casesRouter(db: Database): AppRouter {
  return createRouter().openapi(getCaseRoute(db), async (c) => {
    const { cnr } = c.req.valid('param');
    const found = await getPublicCase(db, actorOf(c), cnr);
    if (found === null) throw new NotFoundError('Case not found.');
    return c.json(
      {
        cnr: found.cnr,
        status: found.status,
        next_hearing_date: found.nextHearingDate,
        last_hearing_date: found.lastHearingDate,
        stage: found.stage,
        bench: found.bench,
        fetched_at: found.fetchedAt.toISOString(),
        orders: found.orders.map((o) => ({
          date: o.date,
          number: o.number,
          summary: o.summary,
          official_url: o.officialUrl,
        })),
        ...recordOf(found),
      },
      200,
    );
  });
}
