// Staff console reads (#310, part of #27): workspace metadata lookup and the platform staff audit;
// and a workspace's usage counters and AI budget overrides (#224, migration 0034).
// The rows live in tenant tables under FORCE RLS, so they come from the owner-defined functions of
// migration 0033, which run only for an enabled staff member (app.user_id, pinned here through
// `withUser`) and return metadata only: plan, seats, storage, dates, flags and the owner's email,
// never matter, document, memory, party or draft content. The admin app reaches these through its
// audited data layer (apps/admin/lib/data), which records `staff.read` first.
import { isUuid, withUser, type Queryable, type Transaction } from '@causedeck/db';
import { sql } from 'drizzle-orm';

import { forbidden } from '../workspaces/index.ts';

/** The keys of a `StaffWorkspaceMetadata`; tests scan responses against this list. */
export const STAFF_WORKSPACE_FIELDS = [
  'workspaceId',
  'slug',
  'name',
  'kind',
  'planId',
  'seats',
  'clerkSeats',
  'memberCount',
  'ownerEmail',
  'storageBytes',
  'createdAt',
  'lastActiveAt',
  'deletedAt',
  'flags',
] as const;

/** The keys of a `StaffUsageCounter`. */
export const STAFF_USAGE_COUNTER_FIELDS = ['key', 'periodStart', 'value'] as const;

/** The keys of a `StaffBudgetOverride`. */
export const STAFF_BUDGET_OVERRIDE_FIELDS = [
  'id',
  'key',
  'limitValue',
  'setBy',
  'reason',
  'expiresAt',
  'createdAt',
  'expiredAt',
  'expiredBy',
  'expireReason',
] as const;

/** The keys of a `StaffAuditEntry`. */
export const STAFF_AUDIT_FIELDS = [
  'id',
  'createdAt',
  'staffUserId',
  'action',
  'workspaceId',
  'sessionId',
  'outcome',
] as const;

export interface StaffWorkspaceFlag {
  key: string;
  enabled: boolean;
}

/** What staff see about a workspace by default: metadata, no content. */
export interface StaffWorkspaceMetadata {
  workspaceId: string;
  slug: string;
  name: string;
  kind: string;
  planId: string | null;
  seats: number | null;
  clerkSeats: number | null;
  memberCount: number;
  ownerEmail: string | null;
  storageBytes: number;
  createdAt: Date;
  lastActiveAt: Date | null;
  deletedAt: Date | null;
  flags: StaffWorkspaceFlag[];
}

/** One staff action from the audit log: who, what, where, under which session; no content. */
export interface StaffAuditEntry {
  id: string;
  createdAt: Date;
  staffUserId: string | null;
  action: string;
  workspaceId: string | null;
  sessionId: string | null;
  outcome: string;
}

export interface StaffAuditCursor {
  createdAt: Date;
  id: string;
}

/** A metered key's value in its newest period (gauges such as `storage.bytes` included). */
export interface StaffUsageCounter {
  key: string;
  periodStart: Date;
  value: number;
}

/** A staff budget override: limit, who set it, why, and when it ends or was ended early. */
export interface StaffBudgetOverride {
  id: string;
  key: string;
  limitValue: number;
  setBy: string;
  reason: string;
  expiresAt: Date;
  createdAt: Date;
  expiredAt: Date | null;
  expiredBy: string | null;
  expireReason: string | null;
}

/** A workspace's usage metadata for staff: counters and overrides, no content. */
export interface StaffWorkspaceUsage {
  counters: StaffUsageCounter[];
  overrides: StaffBudgetOverride[];
}

interface CounterRow extends Record<string, unknown> {
  key: string;
  period_start: Date | string;
  value: number | string;
}

interface OverrideRow extends Record<string, unknown> {
  id: string;
  key: string;
  limit_value: number | string;
  set_by: string;
  reason: string;
  expires_at: Date | string;
  created_at: Date | string;
  expired_at: Date | string | null;
  expired_by: string | null;
  expire_reason: string | null;
}

interface WorkspaceRow extends Record<string, unknown> {
  workspace_id: string;
  slug: string;
  name: string;
  kind: string;
  plan_id: string | null;
  seats: number | null;
  clerk_seats: number | null;
  member_count: number;
  owner_email: string | null;
  storage_bytes: number | string;
  created_at: Date | string;
  last_active_at: Date | string | null;
  deleted_at: Date | string | null;
  flags: unknown;
}

interface AuditRow extends Record<string, unknown> {
  id: string;
  created_at: Date | string;
  actor_user_id: string | null;
  action: string;
  workspace_id: string | null;
  session_id: string | null;
  outcome: string;
}

const MAX_QUERY = 254;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toFlags(value: unknown): StaffWorkspaceFlag[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((f: { key: unknown; enabled: unknown }) => ({
    key: String(f.key),
    enabled: f.enabled === true,
  }));
}

// Explicit picks, never a spread of the row: a column added to the function stays invisible here.
function toWorkspace(row: WorkspaceRow): StaffWorkspaceMetadata {
  return {
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    planId: row.plan_id,
    seats: row.seats,
    clerkSeats: row.clerk_seats,
    memberCount: row.member_count,
    ownerEmail: row.owner_email,
    storageBytes: Number(row.storage_bytes),
    createdAt: toDate(row.created_at),
    lastActiveAt: row.last_active_at === null ? null : toDate(row.last_active_at),
    deletedAt: row.deleted_at === null ? null : toDate(row.deleted_at),
    flags: toFlags(row.flags),
  };
}

function toCounter(row: CounterRow): StaffUsageCounter {
  return { key: row.key, periodStart: toDate(row.period_start), value: Number(row.value) };
}

function toOverride(row: OverrideRow): StaffBudgetOverride {
  return {
    id: row.id,
    key: row.key,
    limitValue: Number(row.limit_value),
    setBy: row.set_by,
    reason: row.reason,
    expiresAt: toDate(row.expires_at),
    createdAt: toDate(row.created_at),
    expiredAt: row.expired_at === null ? null : toDate(row.expired_at),
    expiredBy: row.expired_by,
    expireReason: row.expire_reason,
  };
}

function toAuditEntry(row: AuditRow): StaffAuditEntry {
  return {
    id: row.id,
    createdAt: toDate(row.created_at),
    staffUserId: row.actor_user_id,
    action: row.action,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    outcome: row.outcome,
  };
}

/** The SQLSTATE of a failed query (drizzle wraps the driver error). */
function sqlState(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  return (cause as { code?: string } | null)?.code;
}

/** Run `fn` as staff member `staffUserId`; the definer functions refuse anyone else (FORBIDDEN). */
async function asStaff<T>(
  db: Queryable,
  staffUserId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!isUuid(staffUserId)) throw forbidden('Only enabled staff can read the staff console');
  try {
    return await withUser(db, { userId: staffUserId }, fn);
  } catch (error) {
    if (sqlState(error) === '42501')
      throw forbidden('Only enabled staff can read the staff console');
    throw error;
  }
}

/** Workspaces whose slug starts with `query`, or whose owner's email is `query` (at most `limit`). */
export async function staffWorkspaceSearch(
  db: Queryable,
  staffUserId: string,
  query: string,
  limit = 20,
): Promise<StaffWorkspaceMetadata[]> {
  const q = query.trim();
  if (q.length === 0 || q.length > MAX_QUERY) return [];
  const rows = await asStaff(db, staffUserId, (tx) =>
    tx.execute<WorkspaceRow>(
      sql`select * from app_staff_workspace_search(${q}, ${Math.trunc(limit)}::integer)`,
    ),
  );
  return rows.map(toWorkspace);
}

/** One workspace's metadata, or `null` when the id is not a workspace. */
export async function staffWorkspaceMetadata(
  db: Queryable,
  staffUserId: string,
  workspaceId: string,
): Promise<StaffWorkspaceMetadata | null> {
  if (!isUuid(workspaceId)) {
    // Still refuse a non-staff caller, so the answer does not depend on the input.
    await asStaff(db, staffUserId, (tx) =>
      tx.execute(sql`select 1 from app_staff_workspace_metadata(null::uuid)`),
    );
    return null;
  }
  const rows = await asStaff(db, staffUserId, (tx) =>
    tx.execute<WorkspaceRow>(sql`select * from app_staff_workspace_metadata(${workspaceId}::uuid)`),
  );
  const [row] = rows;
  return row === undefined ? null : toWorkspace(row);
}

/** Staff actions, newest first, older than `before` when given (at most `limit`, up to 100). */
export async function staffAuditEvents(
  db: Queryable,
  staffUserId: string,
  { before, limit = 50 }: { before?: StaffAuditCursor | undefined; limit?: number } = {},
): Promise<StaffAuditEntry[]> {
  if (before !== undefined && (!isUuid(before.id) || Number.isNaN(before.createdAt.getTime()))) {
    throw new TypeError('staffAuditEvents: invalid cursor');
  }
  const at = before === undefined ? null : before.createdAt.toISOString();
  const id = before === undefined ? null : before.id;
  const rows = await asStaff(db, staffUserId, (tx) =>
    tx.execute<AuditRow>(
      sql`select * from app_staff_audit_events(${at}::timestamptz, ${id}::uuid, ${Math.trunc(limit)}::integer)`,
    ),
  );
  return rows.map(toAuditEntry);
}

/** A workspace's usage counters and its newest budget overrides (at most 50), or `null` for a bad id. */
export async function staffWorkspaceUsage(
  db: Queryable,
  staffUserId: string,
  workspaceId: string,
): Promise<StaffWorkspaceUsage | null> {
  if (!isUuid(workspaceId)) {
    // Still refuse a non-staff caller, so the answer does not depend on the input.
    await asStaff(db, staffUserId, (tx) =>
      tx.execute(sql`select 1 from app_staff_workspace_usage(null::uuid)`),
    );
    return null;
  }
  return asStaff(db, staffUserId, async (tx) => {
    const counters = await tx.execute<CounterRow>(
      sql`select * from app_staff_workspace_usage(${workspaceId}::uuid)`,
    );
    const overrides = await tx.execute<OverrideRow>(
      sql`select * from app_staff_budget_overrides(${workspaceId}::uuid, 50)`,
    );
    return { counters: counters.map(toCounter), overrides: overrides.map(toOverride) };
  });
}
