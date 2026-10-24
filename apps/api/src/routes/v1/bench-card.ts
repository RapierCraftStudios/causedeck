// `GET /v1/workspaces/{workspaceId}/matters/{matterId}/bench-card` (#521, D-050): the matter's
// factual bench card (who sat, sitting dates, counts, pace). Legal-gated: with the `bench_facts`
// flag off (the default) the route is a plain 404 and reads nothing.
import { getBenchCard } from '@causedeck/core/court-day';
import type { Database } from '@causedeck/db';
import { z } from '@hono/zod-openapi';

import { NotFoundError } from '../../errors.ts';
import {
  createRouter,
  defineRoute,
  principalOf,
  problemResponses,
  type AppRouter,
} from '../../lib/openapi.ts';
import { authorize } from '../../middleware/authorize.ts';
import { requireFlagMiddleware } from '../../middleware/flags.ts';
import { requireWorkspace } from '../../middleware/workspace.ts';

const BenchCardSchema = z.object({
  benchId: z.string(),
  sat: z.array(z.string()),
  sittings: z.array(
    z.object({
      sittingDate: z.string(),
      hallNo: z.string(),
      itemsListed: z.number(),
      itemsHeard: z.number(),
      itemsDisposed: z.number(),
      minutesPerItem: z.number().nullable(),
    }),
  ),
});

export function benchCardRoute(db: Database) {
  return defineRoute({
    method: 'get',
    path: '/workspaces/{workspaceId}/matters/{matterId}/bench-card',
    operationId: 'getMatterBenchCard',
    tags: ['Court day'],
    summary: 'The matter’s bench card: neutral sitting facts (flag-gated)',
    middleware: [
      requireWorkspace(db),
      requireFlagMiddleware('bench_facts'),
      authorize('matter.read'),
    ],
    request: { params: z.object({ workspaceId: z.string().uuid(), matterId: z.string().uuid() }) },
    responses: {
      200: {
        description: 'The bench card',
        content: { 'application/json': { schema: z.object({ data: BenchCardSchema }) } },
      },
      ...problemResponses(401, 403, 404, 422, 429),
    },
  });
}

export function benchCardRouter(db: Database): AppRouter {
  return createRouter().openapi(benchCardRoute(db), async (c) => {
    const { user } = principalOf(c);
    const { matterId } = c.req.valid('param');
    const card = await getBenchCard(
      { db },
      { workspaceId: c.var.workspaceId, userId: user.id },
      matterId,
    );
    if (card === null) throw new NotFoundError();
    return c.json({ data: card }, 200);
  });
}
