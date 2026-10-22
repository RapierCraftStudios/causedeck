// The activity feed read model (#49; docs/product/09 §5, §6): what the system and people did,
// newest first, for the `/w/[slug]/activity` feed, the end-of-day digest and the activity export.
// Reads run in the actor's workspace scope (RLS), so another workspace's activities never appear.
// An activity about a matter the member may not read is returned redacted: no summary, source,
// model, region or confidence, only that something happened. A viewer reads the feed but cannot
// undo; a clerk sees only the kinds a clerk may act on. Undo itself is the engine's (undo.ts).
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { schema, type Transaction } from '@causedeck/db';
import { and, desc, eq, gte, ilike, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';
import { invalid, notFound } from '../shared/errors.ts';

import { inAutomationScope } from './context.ts';
import { listProposalsForDigest } from './export.ts';
import { AUTOMATION_LEVELS, type AutomationLevel } from './levels.ts';
import type { ActivityRow } from './types.ts';

const { activity, matter, matterRestriction, member } = schema;

/** Activities per page of the feed. */
export const ACTIVITY_PAGE_SIZE = 50;
/** The kinds a clerk may see: the ones a clerk can act on (`task.write`, `document.write`). */
export const CLERK_ACTIVITY_KINDS: readonly string[] = ['task', 'document_attach'];

const CURSOR_TS = sql<string>`to_char(${activity.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const Filters = z.strictObject({
  level: z.enum(AUTOMATION_LEVELS).optional(),
  kind: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,59}$/)
    .optional(),
  matterId: z.uuid().optional(),
  captureId: z.uuid().optional(),
  from: z.date().optional(),
  to: z.date().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.int().min(1).max(ACTIVITY_PAGE_SIZE).default(ACTIVITY_PAGE_SIZE),
});

export type ActivityFilters = z.input<typeof Filters>;

/** One activity as the feed shows it; `redacted` rows carry no detail. */
export interface ActivityView {
  id: string;
  kind: string;
  level: AutomationLevel;
  actor: 'system' | 'user';
  actorUserId: string | null;
  /** Null when `redacted`. */
  summary: string | null;
  redacted: boolean;
  matterId: string | null;
  /** The matter's title; null when `redacted` or the activity has no matter. */
  matterTitle: string | null;
  captureId: string | null;
  inputSource: string | null;
  model: string | null;
  modelVersion: string | null;
  region: string | null;
  confidence: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  undoExpiresAt: string;
  undoneAt: string | null;
  undoneBy: string | null;
  cascadeGroupId: string | null;
  /** An L3 action nobody confirmed or undid, inside its 7-day window. */
  undoable: boolean;
}

export interface ActivityPage {
  items: ActivityView[];
  nextCursor: string | null;
  /** The viewer may undo and reassign (`matter.write`); false for viewers. */
  canUndo: boolean;
}

interface MatterAccess {
  title: string;
  sensitive: boolean;
  readable: boolean;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function matterIdOf(row: Pick<ActivityRow, 'entityRefs'>): string | null {
  const id = row.entityRefs['matterId'];
  return typeof id === 'string' && z.uuid().safeParse(id).success ? id : null;
}

/** The matters the rows name, and whether `member` may read each (restrictions, `can()`). */
async function loadMatterAccess(
  tx: Transaction,
  workspaceId: string,
  viewer: Actor,
  settings: PolicySettings | undefined,
  matterIds: readonly string[],
): Promise<Map<string, MatterAccess>> {
  const out = new Map<string, MatterAccess>();
  if (matterIds.length === 0) return out;
  const rows = await tx
    .select({
      id: matter.id,
      title: matter.title,
      sensitive: matter.sensitive,
      ownerUserId: member.userId,
      allowUserIds: matterRestriction.allowedUserIds,
    })
    .from(matter)
    .leftJoin(
      member,
      and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
    )
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    )
    .where(and(eq(matter.workspaceId, workspaceId), inArray(matter.id, [...matterIds])));
  for (const row of rows) {
    // The junior assignment rule is not a reason to hide a line of the feed: only a restriction is.
    const decision = can(
      { ...viewer, assignedMatterIds: new Set([row.id]) },
      'matter.read',
      {
        kind: 'matter',
        workspaceId,
        matterId: row.id,
        ...(row.allowUserIds === null ? {} : { restricted: { allowUserIds: row.allowUserIds } }),
        ...(row.ownerUserId === null ? {} : { ownerUserId: row.ownerUserId }),
      },
      settings,
    );
    out.set(row.id, { title: row.title, sensitive: row.sensitive, readable: decision.allow });
  }
  return out;
}

function toView(
  row: ActivityRow,
  access: Map<string, MatterAccess>,
  now: Date,
  viewOnly = false,
): ActivityView {
  const matterId = matterIdOf(row);
  const known = matterId === null ? undefined : access.get(matterId);
  const redacted = known !== undefined && !known.readable;
  const source = row.source as { input?: unknown; aiCall?: Record<string, unknown> };
  const undoable =
    row.level === 'L3' &&
    row.undoneAt === null &&
    row.confirmedAt === null &&
    now.getTime() <= row.undoExpiresAt.getTime() &&
    !viewOnly;
  return {
    id: row.id,
    kind: row.kind,
    level: row.level,
    actor: row.actor,
    actorUserId: row.actorUserId,
    summary: redacted ? null : row.summary,
    redacted,
    matterId: redacted ? null : matterId,
    matterTitle: redacted ? null : (known?.title ?? null),
    captureId: row.captureId,
    inputSource: redacted ? null : str(source.input),
    model: redacted ? null : str(source.aiCall?.['model']),
    modelVersion: redacted ? null : str(source.aiCall?.['modelVersion']),
    region: redacted ? null : str(source.aiCall?.['region']),
    confidence: redacted ? null : row.confidence,
    confirmedBy: row.confirmedBy,
    confirmedAt: iso(row.confirmedAt),
    createdAt: row.createdAt.toISOString(),
    undoExpiresAt: row.undoExpiresAt.toISOString(),
    undoneAt: iso(row.undoneAt),
    undoneBy: row.undoneBy,
    cascadeGroupId: row.cascadeGroupId,
    undoable,
  };
}

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { ts: string; id: string } {
  const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const stamp = z.iso.datetime({ precision: 6 }).safeParse(ts);
  const uuid = z.uuid().safeParse(id);
  if (!stamp.success || !uuid.success) throw invalid('Invalid cursor');
  return { ts: stamp.data, id: uuid.data };
}

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * One page of the workspace's activities, newest first (keyset on `created_at, id`), with the
 * filters of the feed. `q` searches the one-line summaries. A clerk gets only `CLERK_ACTIVITY_KINDS`.
 */
export async function listActivities(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: ActivityFilters = {},
): Promise<ActivityPage> {
  const parsed = Filters.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid input');
  const f = parsed.data;
  if (f.from !== undefined && f.to !== undefined && f.from >= f.to) {
    throw invalid('from must be before to');
  }
  const cursor = f.cursor === undefined ? undefined : decodeCursor(f.cursor);
  return inAutomationScope(deps, actor, async (scope) => {
    const { workspaceId } = scope.actor;
    const clerk = scope.member.role === 'clerk';
    const canUndo = can(scope.member, 'matter.write', undefined, scope.deps.settings).allow;
    const kindGate =
      clerk && (f.kind === undefined || CLERK_ACTIVITY_KINDS.includes(f.kind))
        ? inArray(activity.kind, [...CLERK_ACTIVITY_KINDS])
        : undefined;
    if (clerk && f.kind !== undefined && !CLERK_ACTIVITY_KINDS.includes(f.kind)) {
      return { items: [], nextCursor: null, canUndo };
    }
    const rows = await scope.tx
      .select({ row: activity, ts: CURSOR_TS })
      .from(activity)
      .where(
        and(
          eq(activity.workspaceId, workspaceId),
          kindGate,
          f.level === undefined ? undefined : eq(activity.level, f.level),
          f.kind === undefined ? undefined : eq(activity.kind, f.kind),
          f.captureId === undefined ? undefined : eq(activity.captureId, f.captureId),
          f.matterId === undefined
            ? undefined
            : sql`${activity.entityRefs}->>'matterId' = ${f.matterId}`,
          f.from === undefined ? undefined : gte(activity.createdAt, f.from),
          f.to === undefined ? undefined : lt(activity.createdAt, f.to),
          f.q === undefined ? undefined : ilike(activity.summary, `%${likeEscape(f.q)}%`),
          cursor === undefined
            ? undefined
            : sql`(${activity.createdAt}, ${activity.id}) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`,
        ),
      )
      .orderBy(desc(activity.createdAt), desc(activity.id))
      .limit(f.limit + 1);
    const page = rows.slice(0, f.limit);
    const matterIds = [
      ...new Set(page.map(({ row }) => matterIdOf(row)).filter((id): id is string => id !== null)),
    ];
    const access = await loadMatterAccess(
      scope.tx,
      workspaceId,
      scope.member,
      scope.deps.settings,
      matterIds,
    );
    const now = scope.now();
    const last = page.at(-1);
    return {
      items: page.map(({ row }) => toView(row, access, now, !canUndo)),
      nextCursor:
        rows.length > f.limit && last !== undefined ? encodeCursor(last.ts, last.row.id) : null,
      canUndo,
    };
  });
}

/** One activity, or NOT_FOUND (also for a clerk and a kind a clerk may not see). */
export async function getActivityDetail(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { activityId: string },
): Promise<ActivityView> {
  const parsed = z.strictObject({ activityId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid input');
  return inAutomationScope(deps, actor, async (scope) => {
    const { workspaceId } = scope.actor;
    const [row] = await scope.tx
      .select()
      .from(activity)
      .where(and(eq(activity.workspaceId, workspaceId), eq(activity.id, parsed.data.activityId)))
      .limit(1);
    if (row === undefined) throw notFound('Activity not found');
    if (scope.member.role === 'clerk' && !CLERK_ACTIVITY_KINDS.includes(row.kind)) {
      throw notFound('Activity not found');
    }
    const matterId = matterIdOf(row);
    const access = await loadMatterAccess(
      scope.tx,
      workspaceId,
      scope.member,
      scope.deps.settings,
      matterId === null ? [] : [matterId],
    );
    const canUndo = can(scope.member, 'matter.write', undefined, scope.deps.settings).allow;
    return toView(row, access, scope.now(), !canUndo);
  });
}

export interface ActivityDayCount {
  /** The member's local day, `YYYY-MM-DD`. */
  day: string;
  total: number;
  l1: number;
  l2: number;
  l3: number;
}

/** Activities per local day in `timeZone` (default `Asia/Kolkata`), newest day first. */
export async function countByDay(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { from: Date; to: Date; timeZone?: string },
): Promise<ActivityDayCount[]> {
  const parsed = z
    .strictObject({
      from: z.date(),
      to: z.date(),
      timeZone: z.string().min(1).max(64).default('Asia/Kolkata'),
    })
    .safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { from, to, timeZone } = parsed.data;
  if (from >= to) throw invalid('from must be before to');
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
  } catch {
    throw invalid('Unknown time zone');
  }
  return inAutomationScope(deps, actor, async (scope) => {
    const clerk = scope.member.role === 'clerk';
    const day = sql<string>`to_char(${activity.createdAt} at time zone ${timeZone}::text, 'YYYY-MM-DD')`;
    const rows = await scope.tx
      .select({
        day,
        level: activity.level,
        n: sql<number>`count(*)::int`,
      })
      .from(activity)
      .where(
        and(
          eq(activity.workspaceId, scope.actor.workspaceId),
          clerk ? inArray(activity.kind, [...CLERK_ACTIVITY_KINDS]) : undefined,
          gte(activity.createdAt, from),
          lt(activity.createdAt, to),
        ),
      )
      .groupBy(sql`1`, activity.level);
    const byDay = new Map<string, ActivityDayCount>();
    for (const row of rows) {
      const entry = byDay.get(row.day) ?? { day: row.day, total: 0, l1: 0, l2: 0, l3: 0 };
      entry.total += row.n;
      if (row.level === 'L1') entry.l1 += row.n;
      else if (row.level === 'L2') entry.l2 += row.n;
      else if (row.level === 'L3') entry.l3 += row.n;
      byDay.set(row.day, entry);
    }
    return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  });
}

export interface DigestCounts {
  /** L3 actions in the window that nobody undid or confirmed and that are still undoable. */
  l3Count: number;
  /** Open proposals waiting for a person. */
  pendingL2Count: number;
  /** Titles of the matters those actions touched; only when `includeNames`, never sensitive ones. */
  matterTitles: string[];
}

/**
 * What the end-of-day digest counts for `actor` over `[from, to)` (#49). Activities and proposals
 * about a sensitive matter, or one the member may not read, are left out (CA-10); the result is
 * counts and, when `includeNames`, matter titles. No summaries, payloads or document content.
 */
export async function countDigestActivities(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { from: Date; to: Date; includeNames?: boolean },
): Promise<DigestCounts> {
  const { from, to } = input;
  if (from >= to) throw invalid('from must be before to');
  const pending = await listProposalsForDigest(deps, actor);
  return inAutomationScope(deps, actor, async (scope) => {
    const now = scope.now();
    const rows = await scope.tx
      .select({ id: activity.id, entityRefs: activity.entityRefs })
      .from(activity)
      .where(
        and(
          eq(activity.workspaceId, scope.actor.workspaceId),
          eq(activity.level, 'L3'),
          isNull(activity.undoneAt),
          isNull(activity.confirmedAt),
          gte(activity.undoExpiresAt, now),
          gte(activity.createdAt, from),
          lt(activity.createdAt, to),
        ),
      )
      .limit(5000);
    const matterIds = [
      ...new Set(rows.map((r) => matterIdOf(r)).filter((id): id is string => id !== null)),
    ];
    const access = await loadMatterAccess(
      scope.tx,
      scope.actor.workspaceId,
      scope.member,
      scope.deps.settings,
      matterIds,
    );
    const hidden = new Set(
      [...access].filter(([, a]) => a.sensitive || !a.readable).map(([id]) => id),
    );
    const visible = rows.filter((r) => {
      const id = matterIdOf(r);
      return id === null || !hidden.has(id);
    });
    const titles =
      input.includeNames === true
        ? [
            ...new Set(
              visible
                .map((r) => matterIdOf(r))
                .filter((id): id is string => id !== null)
                .map((id) => access.get(id)?.title)
                .filter((t): t is string => t !== undefined),
            ),
          ]
        : [];
    return { l3Count: visible.length, pendingL2Count: pending.length, matterTitles: titles };
  });
}
