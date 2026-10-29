// The onboarding practice profile (#92, memory M1): enrolment number, bar council, courts, practice
// areas and languages. Each value is saved as a confirmed memory item with source `manual` (the
// lawyer typed it), through the memory domain's `createMemoryNote` (and `editMemory` when the item
// already exists, so a repeated step never duplicates). The enrolment number also joins the
// member's advocate identifiers, which the import's matched-only rule reads. Nothing is fetched.
import { schema, withWorkspace } from '@causedeck/db';
import {
  CourtsStepInput,
  ProfileStepInput,
  type CourtsStepInput as CourtsInput,
  type ProfileStepInput as ProfileInput,
} from '@causedeck/validators/onboarding';
import type { MemoryKey } from '@causedeck/validators';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

import { getForum } from '../court/index.ts';
import { getAdvocateProfile, saveAdvocateProfile } from '../import/index.ts';
import { createMemoryNote, editMemory, type MemoryDeps } from '../memory/index.ts';
import { invalid, notFound } from '../shared/errors.ts';
import { memberRole } from '../workspaces/index.ts';

import type { OnboardingActor } from './state.ts';

async function requireMember(deps: MemoryDeps, actor: OnboardingActor): Promise<void> {
  if ((await memberRole(deps.db, actor.userId, actor.workspaceId)) === null) {
    throw notFound('Workspace not found');
  }
}

function parse<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

/** Items the member already confirmed under `keys`, by key (the newest wins). */
async function existingItems(
  deps: MemoryDeps,
  actor: OnboardingActor,
  keys: readonly MemoryKey[],
): Promise<Map<string, string>> {
  const { memoryItem } = schema;
  const rows = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ id: memoryItem.id, key: memoryItem.key })
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.workspaceId, actor.workspaceId),
          eq(memoryItem.ownerUserId, actor.userId),
          eq(memoryItem.scope, 'user'),
          inArray(memoryItem.key, [...keys]),
          inArray(memoryItem.status, ['active', 'paused']),
        ),
      )
      .orderBy(memoryItem.createdAt),
  );
  return new Map(rows.map((row) => [row.key, row.id]));
}

export async function saveManual(
  deps: MemoryDeps,
  actor: OnboardingActor,
  values: readonly { key: MemoryKey; value: string | string[] }[],
): Promise<void> {
  const existing = await existingItems(
    deps,
    actor,
    values.map((entry) => entry.key),
  );
  for (const entry of values) {
    const id = existing.get(entry.key);
    if (id === undefined) {
      await createMemoryNote(deps, actor, { key: entry.key, value: entry.value, scope: 'user' });
    } else {
      await editMemory(deps, actor, id, { value: entry.value });
    }
  }
}

/** Save the profile step: M1 enrolment, bar council, practice areas and languages (confirmed, `manual`). */
export async function saveOnboardingProfile(
  deps: MemoryDeps,
  actor: OnboardingActor,
  input: unknown,
): Promise<ProfileInput> {
  const profile = parse(ProfileStepInput, input);
  await requireMember(deps, actor);
  await saveManual(deps, actor, [
    { key: 'M1.enrolment_number', value: profile.enrolmentNumber },
    { key: 'M1.bar_council', value: profile.barCouncil },
    { key: 'M1.practice_areas', value: profile.practiceAreas },
    { key: 'M1.languages', value: profile.languages },
  ]);
  // The enrolment number is also an identifier the import matches rows against; keep the aliases.
  const identifiers = await getAdvocateProfile(deps.db, actor);
  await saveAdvocateProfile(deps.db, actor, {
    enrolmentNumbers: [...identifiers.enrolmentNumbers, profile.enrolmentNumber],
    aliases: identifiers.aliases,
    confirmed: true,
  });
  return profile;
}

/** Save the courts step: the chosen catalogue forums as M1 courts (confirmed, `manual`). */
export async function saveOnboardingCourts(
  deps: MemoryDeps,
  actor: OnboardingActor,
  input: unknown,
): Promise<CourtsInput> {
  const courts = parse(CourtsStepInput, input);
  await requireMember(deps, actor);
  const codes = [...new Set(courts.forumCodes)];
  // Every code must be a forum this workspace can see (the catalogue or its own); `getForum`
  // throws NOT_FOUND for anything else, so another workspace's forum is never recorded.
  for (const code of codes) await getForum(deps.db, actor.workspaceId, code);
  await saveManual(deps, actor, [{ key: 'M1.courts', value: codes }]);
  return { forumCodes: codes };
}
