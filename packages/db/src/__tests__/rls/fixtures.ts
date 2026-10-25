// Shared fixtures for the row-level security suites (#19): users are global, workspaces and
// memberships are created inside their own workspace scope, as application code must.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../client.ts';
import { member, organization, user } from '../../schema/auth.ts';
import { inWorkspace } from '../../testing/index.ts';

export async function newUser(tx: Transaction): Promise<string> {
  const [row] = await tx
    .insert(user)
    .values({ name: 'Advocate', email: `${randomUUID()}@example.test` })
    .returning({ id: user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

/** A workspace with `members` (each a new user) and the ids of those users. */
export async function newWorkspace(
  tx: Transaction,
  members = 1,
): Promise<{ id: string; userIds: string[] }> {
  const id = randomUUID();
  const userIds: string[] = [];
  for (let i = 0; i < members; i += 1) userIds.push(await newUser(tx));
  await inWorkspace(tx, id, async (scoped) => {
    await scoped.insert(organization).values({ id, name: 'Chambers', slug: `rls-${id}` });
    for (const userId of userIds) {
      await scoped.insert(member).values({ organizationId: id, userId, role: 'advocate' });
    }
  });
  return { id, userIds };
}

/** The Postgres SQLSTATE a rejected query failed with (drizzle wraps the driver error). */
export async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  const cause = (error as { cause?: unknown }).cause ?? error;
  return (cause as { code?: string }).code;
}
