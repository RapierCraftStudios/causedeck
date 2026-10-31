// `GET /v1/orders?case` (#625): with `case` (a CNR), the orders of the caller's own case from a
// cleared source; without it, shared published orders from cleared non-personal sources (D-048).
// Scope `orders:read`.
import { listPublicOrders } from '@causedeck/core/public-api';
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

const OrderSchema = z.object({
  id: z.string(),
  case: z.string().nullable(),
  date: z.string().nullable(),
  number: z.string().nullable(),
  summary: z.string().nullable(),
  content: z.string().nullable(),
  forum: z.string().nullable(),
  ...recordShape,
});

export function listOrdersRoute(db: Database) {
  // authz: public — scope `orders:read` (API keys); the caller's own workspace.
  return defineRoute({
    method: 'get',
    path: '/orders',
    operationId: 'listPublicOrders',
    tags: ['Public API'],
    summary: 'Orders of an own case, or shared published orders from cleared non-personal sources',
    middleware: [requireScope('orders:read'), publicWorkspace(db)],
    request: {
      query: z.object({
        case: z
          .string()
          .regex(/^[A-Z0-9]{16}$/)
          .optional(),
        limit: LimitQuery,
      }),
    },
    responses: {
      200: {
        description: 'Orders',
        content: { 'application/json': { schema: z.object({ data: z.array(OrderSchema) }) } },
      },
      ...problemResponses(401, 403, 422, 429),
    },
  });
}

export function ordersRouter(db: Database): AppRouter {
  return createRouter().openapi(listOrdersRoute(db), async (c) => {
    const query = c.req.valid('query');
    const orders = await listPublicOrders(db, actorOf(c), {
      ...(query.case === undefined ? {} : { caseCnr: query.case }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return c.json(
      {
        data: orders.map((o) => ({
          id: o.id,
          case: o.case,
          date: o.date,
          number: o.number,
          summary: o.summary,
          content: o.content,
          forum: o.forum,
          ...recordOf(o),
        })),
      },
      200,
    );
  });
}
