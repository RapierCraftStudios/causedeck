// `GET /v1/workspaces`: the caller's workspaces, cursor-paginated. Never another user's.
import { listWorkspacesForUser } from '@causedeck/core/workspaces';
import type { Database } from '@causedeck/db';
import { WorkspaceListQuerySchema, WorkspaceListResponseSchema } from '@causedeck/validators/api';

import {
  createRouter,
  defineRoute,
  principalOf,
  problemResponses,
  type AppRouter,
} from '../../lib/openapi.ts';

export const listWorkspacesRoute = defineRoute({
  method: 'get',
  path: '/workspaces',
  operationId: 'listWorkspaces',
  tags: ['Workspaces'],
  summary: "The caller's workspaces",
  request: { query: WorkspaceListQuerySchema },
  responses: {
    200: {
      description: 'One page of workspaces',
      content: {
        'application/json': { schema: WorkspaceListResponseSchema },
      },
    },
    ...problemResponses(401, 422, 429),
  },
});

export function workspacesRouter(db: Database): AppRouter {
  return createRouter().openapi(listWorkspacesRoute, async (c) => {
    const { user } = principalOf(c);
    const { limit, cursor } = c.req.valid('query');
    const page = await listWorkspacesForUser(db, user.id, { limit, cursor });
    return c.json(
      {
        data: page.data.map((w) => ({ ...w, createdAt: w.createdAt.toISOString() })),
        nextCursor: page.nextCursor,
      },
      200,
    );
  });
}
