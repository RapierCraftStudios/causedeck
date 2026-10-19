// Workspace lifecycle (#177, #18): create (atomic with the owner membership and settings) and soft
// delete. Hard deletion with crypto-erase is #31.
import { randomUUID } from 'node:crypto';

import {
  schema,
  withWorkspace,
  type Database,
  type Transaction,
  type Workspace,
} from '@causedeck/db';
import { CreateWorkspaceInput } from '@causedeck/validators/workspace';
import { eq } from 'drizzle-orm';

import { invalid, isUniqueViolation } from './errors.ts';
import { requireOwner } from './members.ts';
import { generateUniqueSlug } from './slug.ts';

type Queryable = Database | Transaction;

const { member, organization, workspaceSettings } = schema;

export interface CreateWorkspaceRequest {
  userId: string;
  input: CreateWorkspaceInput;
}

/**
 * Create a workspace named `input.name` with a generated unique slug. The creator becomes its
 * `owner`, and the organization, membership and settings rows commit together or not at all. The
 * id is chosen here so the inserts run inside the new workspace's scope (row-level security, #19).
 */
export async function createWorkspace(
  db: Queryable,
  { userId, input }: CreateWorkspaceRequest,
): Promise<Workspace> {
  const parsed = CreateWorkspaceInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid workspace');
  const { name, kind } = parsed.data;

  // A concurrent create can take the slug between generation and insert: retry once.
  for (let attempt = 1; ; attempt++) {
    const slug = await generateUniqueSlug(db, name);
    const id = randomUUID();
    try {
      return await withWorkspace(db, { workspaceId: id, userId }, async (tx) => {
        const [workspace] = await tx
          .insert(organization)
          .values({ id, name, slug, kind, createdBy: userId })
          .returning();
        if (!workspace) throw new Error('workspace insert returned no row');
        await tx.insert(member).values({ organizationId: workspace.id, userId, role: 'owner' });
        await tx.insert(workspaceSettings).values({ workspaceId: workspace.id });
        return workspace;
      });
    } catch (error) {
      if (attempt >= 2 || !isUniqueViolation(error, 'organization_slug_uq')) throw error;
    }
  }
}

export interface SoftDeleteRequest {
  workspaceId: string;
  actorUserId: string;
}

/** Owner-only. Hides the workspace from membership queries and slug resolution. */
export async function softDeleteWorkspace(
  db: Queryable,
  request: SoftDeleteRequest,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireOwner(tx, request.workspaceId, request.actorUserId);
    await tx
      .update(organization)
      .set({ deletedAt: new Date() })
      .where(eq(organization.id, request.workspaceId));
  });
}
