// Shared fixtures for the core tests (#227; moved out of audit/__tests__ for #293).
import { randomUUID } from 'node:crypto';

import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import { eq } from 'drizzle-orm';

import { createWorkspace } from '../workspaces/index.ts';

export async function newUser(tx: Transaction): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: 'User', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

/** A user and a workspace they own. */
export async function newWorkspace(
  tx: Transaction,
): Promise<{ ownerId: string; workspaceId: string }> {
  const ownerId = await newUser(tx);
  const workspace = await createWorkspace(tx, {
    userId: ownerId,
    input: { name: `Chambers ${randomUUID().slice(0, 8)}` },
  });
  return { ownerId, workspaceId: workspace.id };
}

/** The SQL state of a failed statement (drizzle wraps the driver error as `cause`). */
export function sqlState(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } } | undefined;
  return e?.cause?.code ?? e?.code;
}

export async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
}

/** Add a new user to the workspace with `role`; returns the user id. */
export async function addMember(
  tx: Transaction,
  workspaceId: string,
  role: 'owner' | 'advocate' | 'junior' | 'clerk' | 'viewer',
): Promise<string> {
  const userId = await newUser(tx);
  await withWorkspace(tx, { workspaceId }, (s) =>
    s.insert(schema.member).values({ organizationId: workspaceId, userId, role }),
  );
  return userId;
}

/** Set the workspace's `advocates_can_read_audit` switch. */
export async function setAdvocatesCanReadAudit(
  tx: Transaction,
  workspaceId: string,
  value: boolean,
): Promise<void> {
  await withWorkspace(tx, { workspaceId }, (s) =>
    s
      .update(schema.workspaceSettings)
      .set({ advocatesCanReadAudit: value })
      .where(eq(schema.workspaceSettings.workspaceId, workspaceId)),
  );
}
