// Shared pieces of the public v1 data routes (#625): the workspace for a key or a member, the
// `as_of` and `official_url` fields every record carries (D-053: no source names), and the snake_case record mapping.
// Responses hold no contributor workspace and no judge rating, ranking or prediction (D-048, D-050).
import type { PublicActor, PublicRecord } from '@causedeck/core/public-api';
import type { Database } from '@causedeck/db';
import { z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';

import { principalOf, type AppEnv } from '../../lib/openapi.ts';
import { requireWorkspace } from '../../middleware/workspace.ts';

/**
 * Workspace for a public route: an API key's own workspace (the key middleware already refused any
 * other one), else the member's `x-workspace-id` through `requireWorkspace`.
 */
export function publicWorkspace(db: Database): MiddlewareHandler<AppEnv> {
  const member = requireWorkspace(db);
  return async (c, next) => {
    const apiKey = c.get('principal')?.apiKey;
    if (apiKey === undefined) return member(c, next);
    c.set('workspaceId', apiKey.workspaceId);
    await next();
  };
}

export function actorOf(c: Context<AppEnv>): PublicActor {
  return { workspaceId: c.get('workspaceId'), userId: principalOf(c).user.id };
}

/** Fields every record carries: when it was captured, and the court's own copy where one exists. */
export const recordShape = {
  as_of: z.string(),
  official_url: z.string().nullable(),
};

export const LimitQuery = z.coerce.number().int().min(1).max(100).optional();

export function recordOf(record: PublicRecord) {
  return { as_of: record.asOf.toISOString(), official_url: record.officialUrl };
}
