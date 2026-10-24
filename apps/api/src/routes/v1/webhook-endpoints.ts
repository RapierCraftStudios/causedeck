// `POST|GET|DELETE /v1/webhook-endpoints` (#626, #487 part 3): a workspace's change-event
// receivers. Every route needs the `webhooks:write` scope for an API key; the workspace is the key's
// own (a cookie caller names it in `x-workspace-id`), never a body field. The signing secret is in
// the creation response only. Managing endpoints needs `workspace.manage`, checked in core against
// the member the key acts as.
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookEndpoints,
  WebhookError,
  type WebhookEndpointSummary,
} from '@causedeck/core/webhooks';
import type { Database } from '@causedeck/db';
import { z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';

import { ConflictError, NotFoundError, ValidationError } from '../../errors.ts';
import {
  createRouter,
  defineRoute,
  principalOf,
  problemResponses,
  requireScope,
  type AppEnv,
  type AppRouter,
} from '../../lib/openapi.ts';
import { requireWorkspace } from '../../middleware/workspace.ts';

const EndpointSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  consecutiveFailures: z.number().int(),
  createdAt: z.string(),
  disabledAt: z.string().nullable(),
});

const CreateBodySchema = z.object({
  url: z.string().max(2048),
  events: z.array(z.string()).min(1).optional(),
});

const CreatedSchema = EndpointSchema.extend({
  /** Shown once; later reads never carry it. */
  secret: z.string(),
});

const IdParamSchema = z.object({ id: z.uuid() });

const SCOPE = 'webhooks:write';

// authz: requireScope('webhooks:write') for a key; `workspace.manage` in core for the member.
export const createWebhookEndpointRoute = defineRoute({
  method: 'post',
  path: '/webhook-endpoints',
  operationId: 'createWebhookEndpoint',
  tags: ['Webhooks'],
  summary: 'Register a webhook endpoint (the secret is returned once)',
  middleware: [requireScope(SCOPE)],
  request: { body: { content: { 'application/json': { schema: CreateBodySchema } } } },
  responses: {
    201: {
      description: 'The endpoint and its signing secret',
      content: { 'application/json': { schema: CreatedSchema } },
    },
    ...problemResponses(401, 403, 409, 422, 429),
  },
});

// authz: requireScope('webhooks:write') for a key; `workspace.manage` in core for the member.
export const listWebhookEndpointsRoute = defineRoute({
  method: 'get',
  path: '/webhook-endpoints',
  operationId: 'listWebhookEndpoints',
  tags: ['Webhooks'],
  summary: "The workspace's webhook endpoints (never the secret)",
  middleware: [requireScope(SCOPE)],
  responses: {
    200: {
      description: 'The endpoints, newest first',
      content: { 'application/json': { schema: z.object({ data: z.array(EndpointSchema) }) } },
    },
    ...problemResponses(401, 403, 429),
  },
});

// authz: requireScope('webhooks:write') for a key; `workspace.manage` in core for the member.
export const deleteWebhookEndpointRoute = defineRoute({
  method: 'delete',
  path: '/webhook-endpoints/{id}',
  operationId: 'deleteWebhookEndpoint',
  tags: ['Webhooks'],
  summary: 'Remove a webhook endpoint and its deliveries',
  middleware: [requireScope(SCOPE)],
  request: { params: IdParamSchema },
  responses: {
    204: { description: 'Removed' },
    ...problemResponses(401, 403, 404, 422, 429),
  },
});

const iso = (value: Date | null) => (value === null ? null : value.toISOString());

const present = (e: WebhookEndpointSummary) => ({
  id: e.id,
  url: e.url,
  events: e.events,
  active: e.active,
  consecutiveFailures: e.consecutiveFailures,
  createdAt: e.createdAt.toISOString(),
  disabledAt: iso(e.disabledAt),
});

/** Maps the domain error to a problem; anything else is left to the error handler. */
function problem(error: unknown): unknown {
  if (!(error instanceof WebhookError)) return error;
  if (error.reason === 'NOT_FOUND') return new NotFoundError(error.message);
  if (error.reason === 'LIMIT') return new ConflictError(error.message);
  return new ValidationError([{ path: 'body', message: error.message }]);
}

export function webhookEndpointsRouter(db: Database): AppRouter {
  // A key is bound to its own workspace; a cookie caller names one and is checked as a member.
  const workspace: MiddlewareHandler<AppEnv> = (c, next) =>
    c.get('principal')?.apiKey === undefined ? requireWorkspace(db)(c, next) : next();
  const scope = (c: Context<AppEnv>) => {
    const { user, apiKey } = principalOf(c);
    return { userId: user.id, workspaceId: apiKey?.workspaceId ?? c.get('workspaceId') };
  };

  const router = createRouter();
  router.use('/webhook-endpoints', workspace);
  router.use('/webhook-endpoints/*', workspace);
  return router
    .openapi(createWebhookEndpointRoute, async (c) => {
      const { userId, workspaceId } = scope(c);
      const body = c.req.valid('json');
      try {
        const created = await createWebhookEndpoint(db, {
          workspaceId,
          actorUserId: userId,
          url: body.url,
          ...(body.events === undefined ? {} : { events: body.events }),
        });
        return c.json({ ...present(created.endpoint), secret: created.secret }, 201);
      } catch (error) {
        throw problem(error);
      }
    })
    .openapi(listWebhookEndpointsRoute, async (c) => {
      const { userId, workspaceId } = scope(c);
      const rows = await listWebhookEndpoints(db, workspaceId, userId);
      return c.json({ data: rows.map(present) }, 200);
    })
    .openapi(deleteWebhookEndpointRoute, async (c) => {
      const { userId, workspaceId } = scope(c);
      try {
        await deleteWebhookEndpoint(db, workspaceId, userId, c.req.valid('param').id);
      } catch (error) {
        throw problem(error);
      }
      return c.body(null, 204);
    });
}
