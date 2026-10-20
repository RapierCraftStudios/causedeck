// Consented, time-boxed support sessions (#308, part of #27; spike §6; PRD PL-6). Platform staff
// request a session with a reason; only the workspace owner may grant it (1 to 240 minutes, default
// 60), deny it or revoke it, and the requesting staff member may end it. A grant is never
// extended: once a session is granted, expired, denied or ended, more time needs a new request and a
// new grant. `assertActiveSupportSession` is the gate every staff content read goes through; an
// elapsed `expires_at` counts as inactive even before the expiry job (`support.session.expire`) has
// flipped the row. Start and end are audited (`support.session_started` / `_ended`, actor kind
// `staff`). Staff are the enabled rows of the global `staff_user` table, which only the operator CLI
// writes (apps/admin `staff:add`, `staff:disable`). See docs/engineering/audit.md.
import { db as appDb, isUuid, schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { recordSupportSessionEnded, recordSupportSessionStarted } from '../audit/index.ts';
import {
  conflict,
  forbidden,
  invalid,
  memberRole,
  notFound,
  WorkspaceError,
} from '../workspaces/index.ts';

const { staffUser, supportSession } = schema;

export type SupportSession = typeof supportSession.$inferSelect;
export type SupportSessionScope = SupportSession['scope'];

/** Default grant length in minutes (1 h). */
export const SUPPORT_GRANT_DEFAULT_MINUTES = 60;
/** Longest grant in minutes (4 h); a CHECK on `support_session` enforces it too. */
export const SUPPORT_GRANT_MAX_MINUTES = 240;
/** Longest request reason, in characters (a CHECK enforces it too). */
export const SUPPORT_REASON_MAX_LENGTH = 500;

/** Optional request metadata carried into audit events. */
export interface SupportRequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/** An authenticated staff member (the admin app authenticates first). */
export interface StaffContext extends SupportRequestMeta {
  db: Queryable;
  staffUserId: string;
}

/** A user acting on one workspace's support sessions: its owner, or the requesting staff member. */
export interface WorkspaceActorContext extends SupportRequestMeta {
  db: Queryable;
  userId: string;
  workspaceId: string;
}

export interface RequestSessionInput {
  workspaceId: string;
  reason: string;
  /** `'view'` (content, read-only) by default; `'metadata'` never reaches content. */
  scope?: SupportSessionScope;
}

export interface GrantSessionInput {
  sessionId: string;
  /** 1 to 240; default 60. */
  minutes?: number;
}

export interface SessionRef {
  sessionId: string;
}

/** No granted, unexpired session for this staff member in this workspace. Maps to FORBIDDEN. */
export class SupportSessionInactiveError extends WorkspaceError {
  readonly reason = 'SUPPORT_SESSION_INACTIVE' as const;

  constructor() {
    super('FORBIDDEN', 'No active support session for this workspace');
  }
}

const sessionNotFound = () => notFound('Support session not found');

function meta(ctx: SupportRequestMeta): SupportRequestMeta {
  return {
    ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
    ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
    ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
  };
}

/** True when `userId` has an enabled `staff_user` row. */
export async function isActiveStaff(db: Queryable, userId: string): Promise<boolean> {
  if (!isUuid(userId)) return false;
  // `staff_user` is global (no RLS), so this reads the same in any scope.
  const rows = await db
    .select({ userId: staffUser.userId })
    .from(staffUser)
    .where(and(eq(staffUser.userId, userId), isNull(staffUser.disabledAt)))
    .limit(1);
  return rows.length > 0;
}

function assertIds(...ids: string[]): void {
  if (!ids.every(isUuid)) throw sessionNotFound();
}

/** Staff ask a workspace for a support session; the owner decides. */
export async function requestSession(
  ctx: StaffContext,
  { workspaceId, reason, scope = 'view' }: RequestSessionInput,
): Promise<SupportSession> {
  if (!isUuid(workspaceId)) throw notFound();
  const trimmed = reason.trim();
  if (trimmed === '' || trimmed.length > SUPPORT_REASON_MAX_LENGTH) {
    throw invalid(`A reason of 1 to ${String(SUPPORT_REASON_MAX_LENGTH)} characters is required`);
  }
  // Untyped callers: anything outside the enum is refused before it reaches the database.
  if (!(schema.SUPPORT_SESSION_SCOPES as readonly string[]).includes(scope)) {
    throw invalid('Unknown support session scope');
  }
  if (!(await isActiveStaff(ctx.db, ctx.staffUserId))) {
    throw forbidden('Only active staff can request a support session');
  }
  const [workspace] = await withWorkspace(ctx.db, { workspaceId }, (tx) =>
    tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(and(eq(schema.organization.id, workspaceId), isNull(schema.organization.deletedAt)))
      .limit(1),
  );
  if (workspace === undefined) throw notFound();
  return withWorkspace(ctx.db, { workspaceId, userId: ctx.staffUserId }, async (tx) => {
    const [row] = await tx
      .insert(supportSession)
      .values({ workspaceId, requestedByStaff: ctx.staffUserId, reason: trimmed, scope })
      .returning();
    if (row === undefined) throw new Error('support_session insert returned nothing');
    return row;
  });
}

async function assertOwner(ctx: WorkspaceActorContext): Promise<void> {
  const role = await memberRole(ctx.db, ctx.userId, ctx.workspaceId);
  if (role !== 'owner') throw forbidden('Only the workspace owner can decide on support sessions');
}

async function lockSession(
  tx: Queryable,
  workspaceId: string,
  sessionId: string,
): Promise<SupportSession> {
  const [row] = await tx
    .select()
    .from(supportSession)
    .where(and(eq(supportSession.id, sessionId), eq(supportSession.workspaceId, workspaceId)))
    .for('update');
  if (row === undefined) throw sessionNotFound();
  return row;
}

function validMinutes(minutes: number | undefined): number {
  const value = minutes ?? SUPPORT_GRANT_DEFAULT_MINUTES;
  if (!Number.isInteger(value) || value < 1 || value > SUPPORT_GRANT_MAX_MINUTES) {
    throw invalid(
      `A support session lasts 1 to ${String(SUPPORT_GRANT_MAX_MINUTES)} minutes (default ${String(SUPPORT_GRANT_DEFAULT_MINUTES)})`,
    );
  }
  return value;
}

/**
 * The owner grants a pending request for `minutes` (default 60, at most 240). Only a `requested`
 * session can be granted, so a session is never extended: more time needs a new request.
 */
export async function grantSession(
  ctx: WorkspaceActorContext,
  { sessionId, minutes }: GrantSessionInput,
): Promise<SupportSession> {
  const length = validMinutes(minutes);
  assertIds(ctx.workspaceId, sessionId);
  await assertOwner(ctx);
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    const current = await lockSession(tx, ctx.workspaceId, sessionId);
    if (current.status !== 'requested') {
      throw conflict('Only a pending request can be granted; staff must request a new session');
    }
    const [row] = await tx
      .update(supportSession)
      .set({
        status: 'granted',
        grantedByUser: ctx.userId,
        grantedAt: sql`now()`,
        expiresAt: sql`now() + make_interval(mins => ${length})`,
      })
      .where(eq(supportSession.id, sessionId))
      .returning();
    if (row === undefined) throw sessionNotFound();
    await recordSupportSessionStarted(
      { db: tx, ...meta(ctx) },
      {
        supportSessionId: row.id,
        staffUserId: row.requestedByStaff,
        workspaceId: row.workspaceId,
      },
    );
    return row;
  });
}

/** The owner turns down a pending request. */
export async function denySession(
  ctx: WorkspaceActorContext,
  { sessionId }: SessionRef,
): Promise<SupportSession> {
  assertIds(ctx.workspaceId, sessionId);
  await assertOwner(ctx);
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    const current = await lockSession(tx, ctx.workspaceId, sessionId);
    if (current.status !== 'requested') throw conflict('Only a pending request can be denied');
    const [row] = await tx
      .update(supportSession)
      .set({ status: 'denied', endedAt: sql`now()` })
      .where(eq(supportSession.id, sessionId))
      .returning();
    if (row === undefined) throw sessionNotFound();
    return row;
  });
}

/**
 * End a pending or granted session now: the workspace owner (`Revoke now`) or the staff member who
 * requested it (`End session`). Ending a granted session is audited as `support.session_ended`.
 */
export async function revokeSession(
  ctx: WorkspaceActorContext,
  { sessionId }: SessionRef,
): Promise<SupportSession> {
  assertIds(ctx.workspaceId, ctx.userId, sessionId);
  const role = await memberRole(ctx.db, ctx.userId, ctx.workspaceId);
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    const current = await lockSession(tx, ctx.workspaceId, sessionId);
    if (role !== 'owner' && current.requestedByStaff !== ctx.userId) {
      throw forbidden('Only the workspace owner or the requesting staff member can end it');
    }
    if (current.status !== 'requested' && current.status !== 'granted') {
      throw conflict('This support session has already ended');
    }
    const [row] = await tx
      .update(supportSession)
      .set({ status: 'ended', endedAt: sql`now()` })
      .where(eq(supportSession.id, sessionId))
      .returning();
    if (row === undefined) throw sessionNotFound();
    if (current.status === 'granted') {
      await recordSupportSessionEnded(
        { db: tx, ...meta(ctx) },
        {
          supportSessionId: row.id,
          staffUserId: row.requestedByStaff,
          workspaceId: row.workspaceId,
          endReason: 'revoked',
        },
      );
    }
    return row;
  });
}

export interface AssertActiveOptions {
  /** Defaults to the app-role client. */
  db?: Queryable;
}

/**
 * The granted, unexpired session that lets `staffId` into `workspaceId`, or
 * `SupportSessionInactiveError`. Disabled staff never have one; an elapsed `expires_at` is inactive
 * even before the expiry job runs.
 */
export async function assertActiveSupportSession(
  staffId: string,
  workspaceId: string,
  { db = appDb }: AssertActiveOptions = {},
): Promise<SupportSession> {
  if (!isUuid(staffId) || !isUuid(workspaceId)) throw new SupportSessionInactiveError();
  if (!(await isActiveStaff(db, staffId))) throw new SupportSessionInactiveError();
  const [row] = await withWorkspace(db, { workspaceId, userId: staffId }, (tx) =>
    tx
      .select()
      .from(supportSession)
      .where(
        and(
          eq(supportSession.workspaceId, workspaceId),
          eq(supportSession.requestedByStaff, staffId),
          eq(supportSession.status, 'granted'),
          gt(supportSession.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(supportSession.expiresAt))
      .limit(1),
  );
  if (row === undefined) throw new SupportSessionInactiveError();
  return row;
}

interface SweptRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  requested_by_staff: string;
}

/**
 * The expiry sweep (`support.session.expire`): flip every elapsed grant to `expired` and audit
 * `support.session_ended` for each, in one transaction. Returns how many expired.
 */
export async function expireSupportSessions(db: Queryable): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<SweptRow>(
      sql`select id, workspace_id, requested_by_staff from app_expire_support_sessions()`,
    );
    for (const row of rows) {
      await recordSupportSessionEnded(
        { db: tx },
        {
          supportSessionId: row.id,
          staffUserId: row.requested_by_staff,
          workspaceId: row.workspace_id,
          endReason: 'expired',
        },
      );
    }
    return rows.length;
  });
}

/**
 * End every pending or granted session of `staffId` at once (the staff member was disabled),
 * auditing `support.session_ended` for each that was granted. Returns how many ended.
 */
export async function endStaffSupportSessions(db: Queryable, staffId: string): Promise<number> {
  if (!isUuid(staffId)) throw new TypeError('endStaffSupportSessions: staffId must be a uuid');
  return db.transaction(async (tx) => {
    const rows = await tx.execute<SweptRow & { was_granted: boolean }>(
      sql`select id, workspace_id, requested_by_staff, was_granted
            from app_end_staff_support_sessions(${staffId}::uuid)`,
    );
    for (const row of rows) {
      if (!row.was_granted) continue;
      await recordSupportSessionEnded(
        { db: tx },
        {
          supportSessionId: row.id,
          staffUserId: row.requested_by_staff,
          workspaceId: row.workspace_id,
          endReason: 'staff_disabled',
        },
      );
    }
    return rows.length;
  });
}
