// `GET /v1/causelists?forum&date&advocate` (#625): shared cause lists from cleared non-personal
// sources only (D-048). `advocate` narrows to the sources the workspace watches under that name;
// it is never a search over shared text. Scope `causelists:read`.
import { listPublicCauseLists } from '@causedeck/core/public-api';
import type { Database } from '@causedeck/db';
import { z } from '@hono/zod-openapi';

import {
  createRouter,
  defineRoute,
  problemResponses,
  requireScope,
  type AppRouter,
} from '../../lib/openapi.ts';

import { actorOf, LimitQuery, publicWorkspace, recordOf, recordShape } from './schemas.ts';

const CauseListSchema = z.object({
  id: z.string(),
  forum: z.string().nullable(),
  listing_date: z.string().nullable(),
  content: z.string(),
  ...recordShape,
});

export function listCauseListsRoute(db: Database) {
  // authz: public — scope `causelists:read` (API keys); the caller's own workspace.
  return defineRoute({
    method: 'get',
    path: '/causelists',
    operationId: 'listPublicCauseLists',
    tags: ['Public API'],
    summary: 'Shared cause lists from cleared, non-personal sources',
    middleware: [requireScope('causelists:read'), publicWorkspace(db)],
    request: {
      query: z.object({
        forum: z.string().min(1).max(200).optional(),
        date: z.iso.date().optional(),
        advocate: z.string().min(1).max(200).optional(),
        limit: LimitQuery,
      }),
    },
    responses: {
      200: {
        description: 'Cause lists',
        content: { 'application/json': { schema: z.object({ data: z.array(CauseListSchema) }) } },
      },
      ...problemResponses(401, 403, 422, 429),
    },
  });
}

export function causeListsRouter(db: Database): AppRouter {
  return createRouter().openapi(listCauseListsRoute(db), async (c) => {
    const query = c.req.valid('query');
    const lists = await listPublicCauseLists(db, actorOf(c), {
      ...(query.forum === undefined ? {} : { forum: query.forum }),
      ...(query.date === undefined ? {} : { date: query.date }),
      ...(query.advocate === undefined ? {} : { advocate: query.advocate }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return c.json(
      {
        data: lists.map((l) => ({
          id: l.id,
          forum: l.forum,
          listing_date: l.listingDate,
          content: l.content,
          ...recordOf(l),
        })),
      },
      200,
    );
  });
}
