// `GET /v1/me`: the caller and their workspace memberships.
import { listMemberships } from '@causedeck/core/workspaces';
import type { Database } from '@causedeck/db';
import { MeResponseSchema } from '@causedeck/validators/api';

import {
  createRouter,
  defineRoute,
  principalOf,
  problemResponses,
  type AppRouter,
} from '../../lib/openapi.ts';

export const meRoute = defineRoute({
  method: 'get',
  path: '/me',
  operationId: 'getMe',
  tags: ['Account'],
  summary: 'The signed-in user and their workspace memberships',
  responses: {
    200: {
      description: 'The caller',
      content: { 'application/json': { schema: MeResponseSchema } },
    },
    ...problemResponses(401, 429),
  },
});

export function meRouter(db: Database): AppRouter {
  return createRouter().openapi(meRoute, async (c) => {
    const { user } = principalOf(c);
    const memberships = await listMemberships(db, user.id);
    return c.json({ user, memberships }, 200);
  });
}
