// Staff flag writes (#22; the staff UI is #27). Only a `StaffActor` may change a flag. Enabling a
// legal-gated (⚖) flag needs a `legal_ack` note, recorded with the actor as `legal_ack_by`; turning
// one off clears the acknowledgement, so it must be given again. Every change writes a
// `flag.changed` audit event (actor, key, old and new value) in the same transaction, and the
// table trigger notifies `flag_changed` so every process drops its cache.
//
// The staff console (#311) enables a legal-gated flag in two steps: `requestLegalEnable` records
// the requester's note as a pending `flag_change_request`, and a different, enabled `admin` staff
// member applies it with `approveLegalEnable` (or turns it down with `rejectLegalEnable`). The
// approval writes the same row and `flag.changed` event as `setFlag`, in the same transaction as
// the request's decision and its audit event.
import { isUuid, withUser, withWorkspace, type Queryable, type Transaction } from '@causedeck/db';
import {
  featureFlag,
  flagChangeRequest,
  staffUser,
  workspaceFeatureFlag,
  type FlagChangeRequestStatus,
} from '@causedeck/db/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { flagAuditSink, type FlagAuditSink } from './audit.ts';
import { getFlag, isFlagKey, type FlagKey } from './keys.ts';

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

export type FlagAdminErrorCode =
  | 'FORBIDDEN'
  | 'LEGAL_ACK_REQUIRED'
  | 'NOT_LEGAL_GATED'
  | 'REQUEST_PENDING'
  | 'REQUEST_NOT_PENDING'
  | 'SELF_APPROVAL';

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

type RowValues = Omit<ReturnType<typeof rowValues>, 'auditNote'>;

/** Upsert the global row under the caller's scope; returns the old value. */
async function writeGlobalRow(tx: Transaction, key: FlagKey, values: RowValues) {
  const [old] = await tx
    .select({ enabled: featureFlag.enabled })
    .from(featureFlag)
    .where(eq(featureFlag.key, key))
    .for('update');
  await tx
    .insert(featureFlag)
    .values({ key, ...values })
    .onConflictDoUpdate({ target: featureFlag.key, set: values });
  return old?.enabled ?? null;
}

/** Upsert one workspace's override under that workspace's scope; returns the old value. */
async function writeWorkspaceRow(
  tx: Transaction,
  workspaceId: string,
  key: FlagKey,
  values: RowValues,
) {
  const [old] = await tx
    .select({ enabled: workspaceFeatureFlag.enabled })
    .from(workspaceFeatureFlag)
    .where(
      and(eq(workspaceFeatureFlag.workspaceId, workspaceId), eq(workspaceFeatureFlag.key, key)),
    )
    .for('update');
  await tx
    .insert(workspaceFeatureFlag)
    .values({ workspaceId, key, ...values })
    .onConflictDoUpdate({
      target: [workspaceFeatureFlag.workspaceId, workspaceFeatureFlag.key],
      set: values,
    });
  return old?.enabled ?? null;
}

async function audit(
  tx: Transaction,
  deps: AdminDeps,
  actor: StaffActor,
  input: SetFlagInput,
  workspaceId: string | null,
  oldValue: boolean | null,
  legalAckNote: string | undefined,
  request?: { requestId: string; requestedBy: string },
): Promise<void> {
  await (deps.audit ?? flagAuditSink).write(tx, {
    action: 'flag.changed',
    actorUserId: actor.userId,
    key: input.key,
    workspaceId,
    oldValue,
    newValue: input.enabled,
    ...(legalAckNote === undefined ? {} : { legalAckNote }),
    ...(request ?? {}),
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
    const old = await writeGlobalRow(tx, input.key, values);
    await audit(tx, deps, actor, input, null, old, auditNote);
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
    const old = await writeWorkspaceRow(tx, workspaceId, input.key, values);
    await audit(tx, deps, actor, input, workspaceId, old, auditNote);
  });
}

// --- Two-person legal-gated enables (#311) -------------------------------------------------------

export interface RequestLegalEnableInput {
  key: FlagKey;
  /** The workspace override to enable; omitted for the global row. */
  workspaceId?: string | undefined;
  /** Why counsel allows it; becomes the row's `legal_ack_note` once approved. */
  legalAckNote: string;
}

export interface FlagChangeRequestRef {
  requestId: string;
}

/** A pending (or decided) legal-gated enable, as the staff console lists it. */
export interface FlagChangeRequestView {
  id: string;
  key: FlagKey;
  workspaceId: string | null;
  status: FlagChangeRequestStatus;
  /** `null` once the requester's account is deleted. */
  requestedBy: string | null;
  requestedAt: Date;
  legalAckNote: string;
}

/** A global flag row, as the staff console shows it. */
export interface GlobalFlagRowView {
  key: FlagKey;
  enabled: boolean;
  legalAckBy: string | null;
  updatedBy: string;
  updatedAt: Date;
}

const notPending = () =>
  new FlagAdminError('REQUEST_NOT_PENDING', 'That request is no longer pending');

function assertStaff(actor: StaffActor): void {
  if (!isStaffActor(actor)) throw new FlagAdminError('FORBIDDEN', 'Only staff can change flags');
}

/** Run `fn` where the target's audit event and row belong: the workspace, or the staff member. */
function inTargetScope<T>(
  db: Queryable,
  actor: StaffActor,
  workspaceId: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return workspaceId === null
    ? withUser(db, { userId: actor.userId }, fn)
    : withWorkspace(db, { workspaceId, userId: actor.userId }, fn);
}

/** The approver must be an enabled `admin` staff member, checked in the database. */
async function assertAdmin(tx: Transaction, userId: string): Promise<void> {
  const [row] = await tx
    .select({ userId: staffUser.userId })
    .from(staffUser)
    .where(
      and(eq(staffUser.userId, userId), eq(staffUser.role, 'admin'), isNull(staffUser.disabledAt)),
    );
  if (!row) throw new FlagAdminError('FORBIDDEN', 'Only an enabled admin can decide this request');
}

function requestEvent(
  action: 'flag.change_requested' | 'flag.change_approved' | 'flag.change_rejected',
  actor: StaffActor,
  key: FlagKey,
  workspaceId: string | null,
  requestId: string,
) {
  return { action, actorUserId: actor.userId, key, workspaceId, requestId, at: new Date() };
}

/** Lock a pending request inside the caller's transaction. */
async function lockPending(tx: Transaction, requestId: string, workspaceId: string | null) {
  const [row] = await tx
    .select()
    .from(flagChangeRequest)
    .where(eq(flagChangeRequest.id, requestId))
    .for('update');
  if (!row || row.status !== 'pending' || row.workspaceId !== workspaceId || !isFlagKey(row.key)) {
    throw notPending();
  }
  return { ...row, key: row.key };
}

/** The target workspace of a request (`undefined` when there is no such request). */
async function requestTarget(db: Queryable, actor: StaffActor, requestId: string) {
  if (!isUuid(requestId)) return undefined;
  const [row] = await withUser(db, { userId: actor.userId }, (tx) =>
    tx
      .select({ workspaceId: flagChangeRequest.workspaceId })
      .from(flagChangeRequest)
      .where(eq(flagChangeRequest.id, requestId)),
  );
  return row;
}

/**
 * Ask for a legal-gated flag to be enabled (globally, or for one workspace). Nothing changes until
 * a second, different admin approves it. One pending request per target (`REQUEST_PENDING`).
 */
export async function requestLegalEnable(
  db: Queryable,
  actor: StaffActor,
  input: RequestLegalEnableInput,
  deps: AdminDeps = {},
): Promise<{ id: string }> {
  assertStaff(actor);
  if (!getFlag(input.key).legalGated) {
    throw new FlagAdminError('NOT_LEGAL_GATED', `${input.key} is not legal-gated`);
  }
  const note = input.legalAckNote.trim();
  if (note === '') {
    throw new FlagAdminError(
      'LEGAL_ACK_REQUIRED',
      `${input.key} is legal-gated: a legal_ack note is required`,
    );
  }
  const workspaceId = input.workspaceId ?? null;
  if (workspaceId !== null && !isUuid(workspaceId)) {
    throw new TypeError('requestLegalEnable: workspaceId must be a uuid');
  }
  return inTargetScope(db, actor, workspaceId, async (tx) => {
    const [row] = await tx
      .insert(flagChangeRequest)
      .values({ key: input.key, workspaceId, legalAckNote: note, requestedBy: actor.userId })
      .onConflictDoNothing()
      .returning({ id: flagChangeRequest.id });
    if (!row) {
      throw new FlagAdminError('REQUEST_PENDING', `${input.key} already has a pending request`);
    }
    await (deps.audit ?? flagAuditSink).write(
      tx,
      requestEvent('flag.change_requested', actor, input.key, workspaceId, row.id),
    );
    return { id: row.id };
  });
}

/**
 * Approve a pending request: an enabled `admin` other than the requester. Writes the flag row
 * (`legal_ack_by` = the requester, `updated_by` = the approver), decides the request and audits
 * both, in one transaction.
 */
export async function approveLegalEnable(
  db: Queryable,
  approver: StaffActor,
  { requestId }: FlagChangeRequestRef,
  deps: AdminDeps = {},
): Promise<void> {
  assertStaff(approver);
  const target = await requestTarget(db, approver, requestId);
  if (!target) throw notPending();
  const { workspaceId } = target;
  await inTargetScope(db, approver, workspaceId, async (tx) => {
    const request = await lockPending(tx, requestId, workspaceId);
    await assertAdmin(tx, approver.userId);
    if (request.requestedBy === approver.userId) {
      throw new FlagAdminError('SELF_APPROVAL', 'A second staff member must approve this request');
    }
    // The requester's account is gone: nobody carries the acknowledgement any more.
    if (request.requestedBy === null) throw notPending();
    const values: RowValues = {
      enabled: true,
      legalAckBy: request.requestedBy,
      legalAckNote: request.legalAckNote,
      updatedBy: approver.userId,
      updatedAt: new Date(),
    };
    const old =
      workspaceId === null
        ? await writeGlobalRow(tx, request.key, values)
        : await writeWorkspaceRow(tx, workspaceId, request.key, values);
    await tx
      .update(flagChangeRequest)
      .set({ status: 'approved', decidedBy: approver.userId, decidedAt: new Date() })
      .where(eq(flagChangeRequest.id, requestId));
    await audit(
      tx,
      deps,
      approver,
      { key: request.key, enabled: true },
      workspaceId,
      old,
      request.legalAckNote,
      { requestId, requestedBy: request.requestedBy },
    );
    await (deps.audit ?? flagAuditSink).write(
      tx,
      requestEvent('flag.change_approved', approver, request.key, workspaceId, requestId),
    );
  });
}

/** Turn a pending request down (an enabled admin) or withdraw it (its requester). */
export async function rejectLegalEnable(
  db: Queryable,
  actor: StaffActor,
  { requestId }: FlagChangeRequestRef,
  deps: AdminDeps = {},
): Promise<void> {
  assertStaff(actor);
  const target = await requestTarget(db, actor, requestId);
  if (!target) throw notPending();
  const { workspaceId } = target;
  await inTargetScope(db, actor, workspaceId, async (tx) => {
    const request = await lockPending(tx, requestId, workspaceId);
    const withdrawn = request.requestedBy === actor.userId;
    if (!withdrawn) await assertAdmin(tx, actor.userId);
    await tx
      .update(flagChangeRequest)
      // A withdrawal has no second decider (the CHECK keeps decided_by off the requester).
      .set({
        status: 'rejected',
        decidedBy: withdrawn ? null : actor.userId,
        decidedAt: new Date(),
      })
      .where(eq(flagChangeRequest.id, requestId));
    await (deps.audit ?? flagAuditSink).write(
      tx,
      requestEvent('flag.change_rejected', actor, request.key, workspaceId, requestId),
    );
  });
}

/** Legal-gated enable requests, oldest first (default: the pending ones). */
export async function listFlagChangeRequests(
  db: Queryable,
  actor: StaffActor,
  { status = 'pending' }: { status?: FlagChangeRequestStatus } = {},
): Promise<FlagChangeRequestView[]> {
  assertStaff(actor);
  const rows = await withUser(db, { userId: actor.userId }, (tx) =>
    tx
      .select({
        id: flagChangeRequest.id,
        key: flagChangeRequest.key,
        workspaceId: flagChangeRequest.workspaceId,
        status: flagChangeRequest.status,
        requestedBy: flagChangeRequest.requestedBy,
        requestedAt: flagChangeRequest.requestedAt,
        legalAckNote: flagChangeRequest.legalAckNote,
      })
      .from(flagChangeRequest)
      .where(eq(flagChangeRequest.status, status))
      .orderBy(asc(flagChangeRequest.requestedAt)),
  );
  // A key removed from the registry has nothing left to enable.
  return rows.flatMap((row) => (isFlagKey(row.key) ? [{ ...row, key: row.key }] : []));
}

/** Every global flag row of a registered key (staff only). */
export async function listGlobalFlagRows(
  db: Queryable,
  actor: StaffActor,
): Promise<GlobalFlagRowView[]> {
  assertStaff(actor);
  const rows = await withUser(db, { userId: actor.userId }, (tx) =>
    tx
      .select({
        key: featureFlag.key,
        enabled: featureFlag.enabled,
        legalAckBy: featureFlag.legalAckBy,
        updatedBy: featureFlag.updatedBy,
        updatedAt: featureFlag.updatedAt,
      })
      .from(featureFlag),
  );
  return rows.flatMap((row) => (isFlagKey(row.key) ? [{ ...row, key: row.key }] : []));
}
