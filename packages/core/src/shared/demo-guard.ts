// The demo-workspace guard (#93): a demo workspace (`organization.is_demo`) is a sandbox of
// fictional data, so nothing it does may leave it. Every outward channel (email, push, WhatsApp,
// webhooks, invitations, billing) and every AI call asks `isDemoWorkspace` before it sends or
// spends, and skips or refuses when it is true. Reads only `organization.is_demo` of the workspace
// the caller is scoped to (RLS), so it needs no cross-workspace access.
import { schema, type Queryable } from '@causedeck/db';
import { eq } from 'drizzle-orm';

import { forbidden, type WorkspaceError } from './errors.ts';

const { organization } = schema;

/** Why outward actions are refused in a demo workspace; shown to the visitor. */
export const DEMO_BLOCKED_MESSAGE =
  'This is a demo workspace with sample data. Nothing here is sent outside it.';

/** The reason recorded where a job skips a demo workspace's delivery. */
export const DEMO_SKIP_REASON = 'demo_workspace';

/** True when `workspaceId` is a demo workspace. A missing workspace is not a demo. */
export async function isDemoWorkspace(db: Queryable, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ isDemo: organization.isDemo })
    .from(organization)
    .where(eq(organization.id, workspaceId));
  return row?.isDemo === true;
}

/** Refuse an outward action in a demo workspace (`FORBIDDEN`). */
export async function assertNotDemoWorkspace(db: Queryable, workspaceId: string): Promise<void> {
  if (await isDemoWorkspace(db, workspaceId)) throw demoBlocked();
}

export function demoBlocked(): WorkspaceError {
  return forbidden(DEMO_BLOCKED_MESSAGE);
}
