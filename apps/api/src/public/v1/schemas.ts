// Shared pieces of the public v1 data routes (#625): the workspace for a key or a member, the
// provenance and `source_license` fields every record carries, and the snake_case record mapping.
// Responses hold no contributor workspace and no judge rating, ranking or prediction (D-048, D-050).
import type { PublicActor, PublicProvenance, PublicRecord } from '@causedeck/core/public-api';
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

export const ProvenanceSchema = z.object({
  source_id: z.string(),
  kind: z.enum(['fetched', 'contributed']),
  ref: z.string().nullable(),
  captured_at: z.string(),
  confidence: z.number().nullable(),
});

/** Fields every record carries. */
export const recordShape = {
  provenance: ProvenanceSchema,
  source_license: z.string(),
};

export const LimitQuery = z.coerce.number().int().min(1).max(100).optional();

export function provenanceOf(p: PublicProvenance): z.infer<typeof ProvenanceSchema> {
  return {
    source_id: p.sourceId,
    kind: p.kind,
    ref: p.ref,
    captured_at: p.capturedAt.toISOString(),
    confidence: p.confidence,
  };
}

export function recordOf(record: PublicRecord) {
  return { provenance: provenanceOf(record.provenance), source_license: record.sourceLicense };
}
