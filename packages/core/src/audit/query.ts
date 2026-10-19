// Reading the audit log (#229, #26 part 4): the `audit.read` gate shared with the export, and the
// paginated activity feed query. Reads run in the workspace's scope, so RLS keeps every other
// workspace's events out; the gate is the central policy (`can()`) with the workspace's
// `advocates_can_read_audit` setting. See docs/engineering/audit.md.
import { can, isRole, type Role } from '@causedeck/auth/policy';
import { schema, withWorkspace, type Queryable, type Transaction } from '@causedeck/db';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { forbidden, invalid, notFound } from '../workspaces/errors.ts';
import { activeMember, liveWorkspace } from '../workspaces/members.ts';
import type { AuditActorKind, AuditOutcome } from './events.ts';
import { truncateIpForDisplay } from './redact.ts';

const { auditEvent, member, organization, workspaceSettings } = schema;

/** Who is reading which workspace's audit log. */
export interface AuditReadContext {
  db: Queryable;
  workspaceId: string;
  userId: string;
}

export interface AuditQueryFilters {
  /** Inclusive lower bound on `created_at`. */
  from?: Date;
  /** Exclusive upper bound on `created_at`. */
  to?: Date;
  actorUserId?: string;
  /** An action or its prefix before a `.` (`member` matches `member.removed`). */
  actionGroup?: string;
  /** `nextCursor` of the previous page. */
  cursor?: string;
  /** Page size, 1 to 200; default 50. */
  limit?: number;
}

/** One event as readers see it: no raw user agent, and `ip` (truncated) for owners only. */
export interface AuditEventView {
  id: string;
  /** ISO 8601 UTC with microseconds. */
  createdAt: string;
  actorUserId: string | null;
  actorKind: AuditActorKind;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  outcome: AuditOutcome;
  requestId: string | null;
  userAgentHash: string | null;
  metadata: Record<string, unknown>;
  /** sha256 chain hash, hex. */
  hash: string;
  ip?: string | null;
}

export interface AuditPage {
  events: AuditEventView[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** The caller's role, checked against `audit.read` (no row locks: this is a read path). */
async function authorizeIn(tx: Transaction, ctx: AuditReadContext): Promise<Role> {
  const [actor] = await tx
    .select({ role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, ctx.workspaceId),
        eq(member.userId, ctx.userId),
        activeMember,
        liveWorkspace,
      ),
    )
    .limit(1);
  if (!actor || !isRole(actor.role)) throw notFound();
  const [settings] = await tx
    .select({ advocatesCanReadAudit: workspaceSettings.advocatesCanReadAudit })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, ctx.workspaceId));
  const decision = can(
    { userId: ctx.userId, workspaceId: ctx.workspaceId, role: actor.role },
    'audit.read',
    undefined,
    { advocatesCanReadAudit: settings?.advocatesCanReadAudit ?? true },
  );
  if (!decision.allow) throw forbidden('You cannot read the audit log');
  return actor.role;
}

function checkUuid(value: string, what: string): void {
  if (!UUID.test(value)) throw invalid(`${what} must be a uuid`);
}

/**
 * Check that `userId` may read `workspaceId`'s audit log (`audit.read`: owners; advocates unless
 * the workspace turned it off). Not an active member of a live workspace is `NOT_FOUND`; a member
 * the policy denies is `FORBIDDEN`. Returns the caller's role.
 */
export async function authorizeAuditRead(ctx: AuditReadContext): Promise<Role> {
  checkUuid(ctx.workspaceId, 'workspaceId');
  checkUuid(ctx.userId, 'userId');
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, (tx) =>
    authorizeIn(tx, ctx),
  );
}

interface Position {
  t: string;
  i: string;
}

function encodeCursor(position: Position): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Position {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid('Invalid cursor');
  }
  const { t, i } = (parsed ?? {}) as Partial<Position>;
  if (typeof t !== 'string' || !CURSOR_TS.test(t) || typeof i !== 'string' || !UUID.test(i)) {
    throw invalid('Invalid cursor');
  }
  return { t, i };
}

/** `created_at` as ISO 8601 UTC with microseconds: exact, so it can carry a keyset position. */
const createdAtIso = sql<string>`to_char(${auditEvent.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const columns = {
  id: auditEvent.id,
  createdAt: createdAtIso,
  actorUserId: auditEvent.actorUserId,
  actorKind: auditEvent.actorKind,
  action: auditEvent.action,
  targetKind: auditEvent.targetKind,
  targetId: auditEvent.targetId,
  outcome: auditEvent.outcome,
  requestId: auditEvent.requestId,
  userAgentHash: auditEvent.userAgentHash,
  metadata: auditEvent.metadata,
  hash: auditEvent.hash,
  ip: auditEvent.ip,
};

type Row = {
  [K in keyof typeof columns]: K extends 'createdAt' ? string : (typeof auditEvent.$inferSelect)[K];
};

export interface AuditRange {
  from?: Date | undefined;
  to?: Date | undefined;
  actorUserId?: string | undefined;
  actionGroup?: string | undefined;
}

/** Validate the filters shared by the feed and the export. */
export function checkAuditRange(range: AuditRange): void {
  for (const bound of [range.from, range.to]) {
    if (bound !== undefined && Number.isNaN(bound.getTime())) throw invalid('Invalid date');
  }
  if (range.from && range.to && range.from >= range.to) {
    throw invalid('from must be before to');
  }
  if (range.actorUserId !== undefined) checkUuid(range.actorUserId, 'actorUserId');
  if (range.actionGroup !== undefined && !/^[a-z][a-z0-9_.]{0,99}$/.test(range.actionGroup)) {
    throw invalid('Invalid action group');
  }
}

function rangeWhere(workspaceId: string, range: AuditRange): SQL[] {
  const where: SQL[] = [eq(auditEvent.workspaceId, workspaceId)];
  if (range.from)
    where.push(sql`${auditEvent.createdAt} >= ${range.from.toISOString()}::timestamptz`);
  if (range.to) where.push(sql`${auditEvent.createdAt} < ${range.to.toISOString()}::timestamptz`);
  if (range.actorUserId) where.push(eq(auditEvent.actorUserId, range.actorUserId));
  if (range.actionGroup) {
    // The pattern only holds [a-z0-9_.]; `_` is escaped so it matches itself.
    const prefix = `${range.actionGroup.replaceAll('_', '\\_')}.%`;
    where.push(
      sql`(${auditEvent.action} = ${range.actionGroup} or ${auditEvent.action} like ${prefix})`,
    );
  }
  return where;
}

/**
 * One keyset page of events in `(created_at, id)` order, after `position` when given. Runs in the
 * workspace's scope (`tx` must already be in it).
 */
export async function auditPage(
  tx: Transaction,
  workspaceId: string,
  range: AuditRange,
  order: 'asc' | 'desc',
  limit: number,
  position?: Position,
): Promise<Row[]> {
  const where = rangeWhere(workspaceId, range);
  if (position) {
    const cmp = order === 'asc' ? sql.raw('>') : sql.raw('<');
    where.push(
      sql`(${auditEvent.createdAt}, ${auditEvent.id}) ${cmp} (${position.t}::timestamptz, ${position.i}::uuid)`,
    );
  }
  const direction = sql.raw(order);
  return tx
    .select(columns)
    .from(auditEvent)
    .where(and(...where))
    .orderBy(sql`${auditEvent.createdAt} ${direction}`, sql`${auditEvent.id} ${direction}`)
    .limit(limit);
}

/** The keyset position just after `row`. */
export function positionOf(row: Row): Position {
  return { t: row.createdAt, i: row.id };
}

/** A row as readers see it; `withIp` only for owners. */
export function toView(row: Row, withIp: boolean): AuditEventView {
  const view: AuditEventView = {
    id: row.id,
    createdAt: row.createdAt,
    actorUserId: row.actorUserId,
    actorKind: row.actorKind,
    action: row.action,
    targetKind: row.targetKind,
    targetId: row.targetId,
    outcome: row.outcome,
    requestId: row.requestId,
    userAgentHash: row.userAgentHash,
    metadata: row.metadata,
    hash: row.hash.toString('hex'),
  };
  if (withIp) view.ip = truncateIpForDisplay(row.ip);
  return view;
}

/**
 * The activity feed: newest first, filtered by date range, actor and action group, paged by an
 * opaque cursor. Gated by `audit.read`; owners also see the (truncated) IP.
 */
export async function queryAudit(
  ctx: AuditReadContext,
  filters: AuditQueryFilters = {},
): Promise<AuditPage> {
  checkUuid(ctx.workspaceId, 'workspaceId');
  checkUuid(ctx.userId, 'userId');
  checkAuditRange(filters);
  const limit = filters.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalid(`limit must be an integer from 1 to ${String(MAX_LIMIT)}`);
  }
  const position = filters.cursor === undefined ? undefined : decodeCursor(filters.cursor);
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    const role = await authorizeIn(tx, ctx);
    const rows = await auditPage(tx, ctx.workspaceId, filters, 'desc', limit + 1, position);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      events: page.map((row) => toView(row, role === 'owner')),
      nextCursor: rows.length > limit && last ? encodeCursor(positionOf(last)) : null,
    };
  });
}
