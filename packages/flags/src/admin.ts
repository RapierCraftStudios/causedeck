// Staff flag writes (#22; the staff UI is #27). Only a `StaffActor` may change a flag. Enabling a
// legal-gated (⚖) flag needs a `legal_ack` note, recorded with the actor as `legal_ack_by`; turning
// one off clears the acknowledgement, so it must be given again. Every change writes a
// `flag.changed` audit event (actor, key, old and new value) in the same transaction, and the
// table trigger notifies `flag_changed` so every process drops its cache.
import { isUuid, withUser, withWorkspace, type Queryable, type Transaction } from '@causedeck/db';
import { featureFlag, workspaceFeatureFlag } from '@causedeck/db/schema';
import { and, eq } from 'drizzle-orm';

import { flagAuditSink, type FlagAuditSink } from './audit.ts';
import { getFlag, type FlagKey } from './keys.ts';

const STAFF: unique symbol = Symbol('causedeck.flags.staff');

/** A platform staff member. Only `asStaff` makes one; the admin app authenticates staff first. */
export interface StaffActor {
  readonly userId: string;
  readonly [STAFF]: true;
}

/** Mark `userId` as an authenticated staff member. Call only after staff authentication (#27). */
export function asStaff(userId: string): StaffActor {
  if (!isUuid(userId)) throw new TypeError('asStaff: userId must be a uuid');
  return Object.freeze({ userId, [STAFF]: true as const });
}

export function isStaffActor(actor: unknown): actor is StaffActor {
  return (
    typeof actor === 'object' && actor !== null && (actor as Partial<StaffActor>)[STAFF] === true
  );
}

export type FlagAdminErrorCode = 'FORBIDDEN' | 'LEGAL_ACK_REQUIRED';

export class FlagAdminError extends Error {
  readonly code: FlagAdminErrorCode;

  constructor(code: FlagAdminErrorCode, message: string) {
    super(message);
    this.name = 'FlagAdminError';
    this.code = code;
  }
}

export interface SetFlagInput {
  key: FlagKey;
  enabled: boolean;
  /** Required to enable a legal-gated flag: why counsel allows it (the deliverable reference). */
  legalAckNote?: string | undefined;
}

export interface SetWorkspaceFlagInput extends SetFlagInput {
  workspaceId: string;
}

export interface AdminDeps {
  /** Defaults to the installed flag audit sink. */
  audit?: FlagAuditSink;
}

/** The columns written for a change: legal ack only on a legal-gated enable. */
function rowValues(actor: StaffActor, { key, enabled, legalAckNote }: SetFlagInput) {
  const def = getFlag(key);
  if (!isStaffActor(actor)) throw new FlagAdminError('FORBIDDEN', 'Only staff can change flags');
  const note = legalAckNote?.trim() ?? '';
  const ack = def.legalGated && enabled;
  if (ack && note === '') {
    throw new FlagAdminError(
      'LEGAL_ACK_REQUIRED',
      `${key} is legal-gated: a legal_ack note is required`,
    );
  }
  return {
    enabled,
    legalAckBy: ack ? actor.userId : null,
    legalAckNote: ack ? note : null,
    updatedBy: actor.userId,
    updatedAt: new Date(),
    auditNote: ack ? note : undefined,
  };
}

async function audit(
  tx: Transaction,
  deps: AdminDeps,
  actor: StaffActor,
  input: SetFlagInput,
  workspaceId: string | null,
  oldValue: boolean | null,
  legalAckNote: string | undefined,
): Promise<void> {
  await (deps.audit ?? flagAuditSink).write(tx, {
    action: 'flag.changed',
    actorUserId: actor.userId,
    key: input.key,
    workspaceId,
    oldValue,
    newValue: input.enabled,
    ...(legalAckNote === undefined ? {} : { legalAckNote }),
    at: new Date(),
  });
}

/** Set the global row for a flag (staff only). */
export async function setFlag(
  db: Queryable,
  actor: StaffActor,
  input: SetFlagInput,
  deps: AdminDeps = {},
): Promise<void> {
  const { auditNote, ...values } = rowValues(actor, input);
  await withUser(db, { userId: actor.userId }, async (tx) => {
    const [old] = await tx
      .select({ enabled: featureFlag.enabled })
      .from(featureFlag)
      .where(eq(featureFlag.key, input.key))
      .for('update');
    await tx
      .insert(featureFlag)
      .values({ key: input.key, ...values })
      .onConflictDoUpdate({ target: featureFlag.key, set: values });
    await audit(tx, deps, actor, input, null, old?.enabled ?? null, auditNote);
  });
}

/** Set one workspace's override for a flag (staff only). */
export async function setWorkspaceFlag(
  db: Queryable,
  actor: StaffActor,
  { workspaceId, ...input }: SetWorkspaceFlagInput,
  deps: AdminDeps = {},
): Promise<void> {
  const { auditNote, ...values } = rowValues(actor, input);
  await withWorkspace(db, { workspaceId, userId: actor.userId }, async (tx) => {
    const [old] = await tx
      .select({ enabled: workspaceFeatureFlag.enabled })
      .from(workspaceFeatureFlag)
      .where(
        and(
          eq(workspaceFeatureFlag.workspaceId, workspaceId),
          eq(workspaceFeatureFlag.key, input.key),
        ),
      )
      .for('update');
    await tx
      .insert(workspaceFeatureFlag)
      .values({ workspaceId, key: input.key, ...values })
      .onConflictDoUpdate({
        target: [workspaceFeatureFlag.workspaceId, workspaceFeatureFlag.key],
        set: values,
      });
    await audit(tx, deps, actor, input, workspaceId, old?.enabled ?? null, auditNote);
  });
}
