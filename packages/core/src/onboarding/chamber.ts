// Chamber onboarding settings (#92): the delegation defaults and the default brief format an owner
// or advocate (`workspace.manage`) chooses for the chamber. Both are saved to `workspace_settings`
// in the caller's transaction; the brief format is also the owner's own M2 `brief_format` (a
// confirmed, `manual` memory item), so the first brief the owner opens already uses it, and members
// without a format of their own get the chamber default through the brief memory provider.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import {
  BriefFormatStepInput,
  DelegationDefaults,
  readDelegationDefaults,
  type BriefFormatStepInput as BriefFormatInput,
  type DelegationDefaults as DelegationDefaultsInput,
} from '@causedeck/validators/onboarding';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { type MemoryDeps } from '../memory/index.ts';
import { invalid } from '../shared/errors.ts';
import { requireCan } from '../workspaces/index.ts';

import { saveManual } from './profile.ts';
import type { OnboardingActor } from './state.ts';

const { workspaceSettings } = schema;

type Db = Database | Transaction;

function parse<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw invalid(issue?.message ?? 'Invalid input');
  }
  return parsed.data;
}

/** Set a column of the workspace's settings row (created if a legacy workspace has none). */
async function writeSettings(
  db: Db,
  actor: OnboardingActor,
  values: Partial<typeof workspaceSettings.$inferInsert>,
): Promise<void> {
  await withWorkspace(db, actor, async (tx) => {
    await requireCan(tx, actor.workspaceId, actor.userId, 'workspace.manage');
    await tx
      .insert(workspaceSettings)
      .values({ workspaceId: actor.workspaceId, ...values })
      .onConflictDoUpdate({ target: workspaceSettings.workspaceId, set: values });
  });
}

/** Save the chamber's delegation defaults. Needs `workspace.manage`. */
export async function saveChamberDelegation(
  db: Db,
  actor: OnboardingActor,
  input: unknown,
): Promise<DelegationDefaultsInput> {
  const defaults = parse(DelegationDefaults, input);
  await writeSettings(db, actor, { delegationDefaults: defaults });
  return defaults;
}

/** The chamber's saved delegation defaults and brief format (the starting ones when never saved). */
export async function getChamberDefaults(
  db: Db,
  actor: OnboardingActor,
): Promise<{ delegation: DelegationDefaultsInput; briefFormat: BriefFormatInput['briefFormat'] }> {
  const [row] = await withWorkspace(db, actor, (tx) =>
    tx
      .select({
        delegationDefaults: workspaceSettings.delegationDefaults,
        briefFormat: workspaceSettings.briefFormat,
      })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, actor.workspaceId)),
  );
  return {
    delegation: readDelegationDefaults(row?.delegationDefaults),
    briefFormat: row?.briefFormat === 'short' ? 'short' : 'full',
  };
}

/** Save the chamber's default brief format and the saver's own M2 brief format. Needs `workspace.manage`. */
export async function saveChamberBriefFormat(
  deps: MemoryDeps,
  actor: OnboardingActor,
  input: unknown,
): Promise<BriefFormatInput> {
  const { briefFormat } = parse(BriefFormatStepInput, input);
  await writeSettings(deps.db, actor, { briefFormat });
  await saveManual(deps, actor, [{ key: 'M2.brief_format', value: briefFormat }]);
  return { briefFormat };
}
