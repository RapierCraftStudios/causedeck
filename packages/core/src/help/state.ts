// In-app help state (#94): which first-run coachmarks a member has dismissed in a workspace.
// A dismissal is per user and per workspace (`help_state`, FORCE RLS), never visible to others, and
// idempotent: dismissing twice keeps the first time.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { invalid, notFound } from '../shared/errors.ts';
import { memberRole } from '../workspaces/index.ts';

const { helpState } = schema;

type Db = Database | Transaction;

export interface HelpActor {
  userId: string;
  workspaceId: string;
}

const KEY = new RegExp(schema.HELP_STATE_KEY_PATTERN);

async function requireMember(db: Db, actor: HelpActor): Promise<void> {
  if ((await memberRole(db, actor.userId, actor.workspaceId)) === null) {
    throw notFound('Workspace not found');
  }
}

/** Record that the member dismissed the coachmark `key` (e.g. `coachmark.today`). */
export async function dismissCoachmark(
  db: Db,
  actor: HelpActor,
  input: { key: string },
): Promise<void> {
  if (!KEY.test(input.key)) throw invalid('Unknown help key');
  await requireMember(db, actor);
  await withWorkspace(db, actor, (tx) =>
    tx
      .insert(helpState)
      .values({ workspaceId: actor.workspaceId, userId: actor.userId, key: input.key })
      .onConflictDoNothing(),
  );
}

/** The keys the member has dismissed in this workspace. */
export async function listDismissedCoachmarks(db: Db, actor: HelpActor): Promise<string[]> {
  await requireMember(db, actor);
  const rows = await withWorkspace(db, actor, (tx) =>
    tx
      .select({ key: helpState.key })
      .from(helpState)
      .where(and(eq(helpState.workspaceId, actor.workspaceId), eq(helpState.userId, actor.userId)))
      .orderBy(helpState.key),
  );
  return rows.map((row) => row.key);
}
