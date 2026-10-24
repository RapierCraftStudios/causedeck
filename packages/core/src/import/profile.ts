// The importing advocate's identifiers (#57 part 4, #550): the enrolment numbers and name aliases the
// matched-only rule reads. They are kept per member in `advocate_profile` and written only after the
// member confirmed what the import proposed (`confirmed: true`); without it the call returns the
// normalised proposal and writes nothing.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';

import {
  getAdvocateIdentifiers,
  hasIdentifiers,
  type AdvocateIdentifierInput,
  type AdvocateIdentifiers,
} from './identifiers.ts';

const MAX_ENROLMENTS = 20;
const MAX_ALIASES = 50;

export interface ProfileScope {
  workspaceId: string;
  userId: string;
}

export interface SaveProfileResult {
  saved: boolean;
  /** What was proposed (and, when `saved`, stored): normalised, sorted and unique. */
  identifiers: AdvocateIdentifiers;
}

/** The identifiers `userId` saved in this workspace; empty when none were saved. */
export async function getAdvocateProfile(
  db: Database | Transaction,
  scope: ProfileScope,
): Promise<AdvocateIdentifiers> {
  const { advocateProfile } = schema;
  const [row] = await withWorkspace(db, scope, (tx) =>
    tx
      .select({
        enrolmentNumbers: advocateProfile.enrolmentNumbers,
        aliases: advocateProfile.aliases,
      })
      .from(advocateProfile)
      .where(
        and(
          eq(advocateProfile.workspaceId, scope.workspaceId),
          eq(advocateProfile.userId, scope.userId),
        ),
      ),
  );
  return row === undefined
    ? { enrolmentNumbers: [], aliases: [] }
    : { enrolmentNumbers: [...row.enrolmentNumbers], aliases: [...row.aliases] };
}

/**
 * Propose, and with `confirmed` save, the member's identifiers. An empty proposal is refused (it
 * would clear the profile and import nothing).
 */
export async function saveAdvocateProfile(
  db: Database | Transaction,
  scope: ProfileScope,
  input: AdvocateIdentifierInput & { confirmed: boolean },
): Promise<SaveProfileResult> {
  const identifiers = getAdvocateIdentifiers(input);
  if (!hasIdentifiers(identifiers)) throw invalid('Enter an enrolment number or a name spelling');
  if (
    identifiers.enrolmentNumbers.length > MAX_ENROLMENTS ||
    identifiers.aliases.length > MAX_ALIASES
  ) {
    throw invalid('Too many identifiers');
  }
  if (!input.confirmed) return { saved: false, identifiers };
  const { advocateProfile } = schema;
  await withWorkspace(db, scope, (tx) =>
    tx
      .insert(advocateProfile)
      .values({ workspaceId: scope.workspaceId, userId: scope.userId, ...identifiers })
      .onConflictDoUpdate({
        target: [advocateProfile.workspaceId, advocateProfile.userId],
        set: { ...identifiers, updatedAt: new Date() },
      }),
  );
  return { saved: true, identifiers };
}
