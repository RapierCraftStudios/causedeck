// Shared fixtures for the audit tests (#227).
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';

import { createWorkspace } from '../../workspaces/index.ts';

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
