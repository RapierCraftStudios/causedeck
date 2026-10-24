// `GET /v1/notices?forum` (#625): official notices from cleared non-personal sources (D-048).
// Scope `notices:read`.
import { listPublicNotices } from '@causedeck/core/public-api';
import type { Database } from '@causedeck/db';
import { z } from '@hono/zod-openapi';

import {
  createRouter,
  defineRoute,
  problemResponses,
  requireScope,
  type AppRouter,
} from '../../lib/openapi.ts';

import { LimitQuery, publicWorkspace, recordOf, recordShape } from './schemas.ts';

const NoticeSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  issued_on: z.string(),
  effective_on: z.string().nullable(),
  url: z.string(),
  forum_codes: z.array(z.string()),
  ...recordShape,
});

export function listNoticesRoute(db: Database) {
  // authz: public — scope `notices:read` (API keys); global notices of cleared non-personal sources.
  return defineRoute({
    method: 'get',
    path: '/notices',
    operationId: 'listPublicNotices',
    tags: ['Public API'],
    summary: 'Official notices from cleared, non-personal sources',
    middleware: [requireScope('notices:read'), publicWorkspace(db)],
    request: {
      query: z.object({ forum: z.string().min(1).max(100).optional(), limit: LimitQuery }),
    },
    responses: {
      200: {
        description: 'Notices',
        content: { 'application/json': { schema: z.object({ data: z.array(NoticeSchema) }) } },
      },
      ...problemResponses(401, 403, 422, 429),
    },
  });
}

export function noticesRouter(db: Database): AppRouter {
  return createRouter().openapi(listNoticesRoute(db), async (c) => {
    const query = c.req.valid('query');
    const notices = await listPublicNotices(db, {
      ...(query.forum === undefined ? {} : { forum: query.forum }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return c.json(
      {
        data: notices.map((n) => ({
          id: n.id,
          title: n.title,
          kind: n.kind,
          issued_on: n.issuedOn,
          effective_on: n.effectiveOn,
          url: n.url,
          forum_codes: n.forumCodes,
          ...recordOf(n),
        })),
      },
      200,
    );
  });
}
