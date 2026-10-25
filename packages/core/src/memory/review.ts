// Memory metrics and the monthly review (#72). Aggregates only, within one workspace: counts and
// rates by tenure week (weeks since the workspace was created), never a value, a key or a name.
import { schema, withWorkspace } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { forbidden } from '../shared/errors.ts';

import {
  canWriteMemory,
  inScope,
  nowOf,
  opener,
  requireRole,
  sealValue,
  type Db,
  type MemoryActor,
  type MemoryDeps,
} from './scope.ts';

const { organization, memoryItem } = schema;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** An active item not used for this long is offered for review. */
export const MEMORY_STALE_AFTER_DAYS = 90;

export interface TenureWeek {
  /** 0 is the workspace's first week. */
  week: number;
  proposalsDecided: number;
  confirmed: number;
  /** confirmed / decided; null when nothing was decided that week. */
  confirmationRate: number | null;
  itemsSaved: number;
  corrected: number;
  /** corrected / saved; null when nothing was saved that week. */
  correctionRate: number | null;
}

export interface TenureMetrics {
  weeks: TenureWeek[];
  /** Briefs that used memory and were not edited into a proposed pattern; null with no briefs. */
  briefAcceptedUnedited: { briefs: number; unedited: number; rate: number | null };
}

const rate = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;

/**
 * Correction rate and confirmation rate by tenure week, plus the brief-accepted-unedited rate.
 * Owners and advocates only; the aggregate covers the actor's workspace and nothing else.
 */
export async function tenureMetrics(deps: MemoryDeps, actor: MemoryActor): Promise<TenureMetrics> {
  const role = await requireRole(deps, actor);
  if (role !== 'owner' && role !== 'advocate')
    throw forbidden('Only owners and advocates see memory metrics');
  return computeMetrics(deps.db, actor.workspaceId);
}

async function computeMetrics(db: Db, workspaceId: string): Promise<TenureMetrics> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const [org] = await tx
      .select({ createdAt: organization.createdAt })
      .from(organization)
      .where(eq(organization.id, workspaceId));
    const start = (org?.createdAt ?? new Date(0)).toISOString();
    const week = (column: string) =>
      sql.raw(
        `floor(extract(epoch from (${column} - '${start}'::timestamptz)) / ${String(WEEK_MS / 1000)})::int`,
      );
    const decided = await tx.execute<{ week: number; decided: number; confirmed: number }>(sql`
      select ${week('decided_at')} as week, count(*)::int as decided,
             count(*) filter (where status = 'confirmed')::int as confirmed
      from memory_proposal
      where workspace_id = ${workspaceId}::uuid and status in ('confirmed', 'dismissed')
      group by 1`);
    const saved = await tx.execute<{ week: number; saved: number; corrected: number }>(sql`
      select ${week('created_at')} as week, count(*)::int as saved,
             count(*) filter (where confirmation_state = 'corrected')::int as corrected
      from memory_item
      where workspace_id = ${workspaceId}::uuid
      group by 1`);
    const [briefs] = await tx.execute<{ briefs: number; edited: number }>(sql`
      with b as (
        select distinct output_ref from memory_usage
        where workspace_id = ${workspaceId}::uuid and used_in = 'brief' and output_ref is not null),
      e as (
        select distinct jsonb_array_elements_text(evidence -> 'outputIds') as output_ref
        from memory_proposal
        where workspace_id = ${workspaceId}::uuid and source_type = 'edit'
          and jsonb_typeof(evidence -> 'outputIds') = 'array')
      select (select count(*) from b)::int as briefs,
             (select count(*) from b where output_ref in (select output_ref from e))::int as edited`);

    const byWeek = new Map<number, TenureWeek>();
    const at = (n: number): TenureWeek => {
      let w = byWeek.get(n);
      if (!w) {
        w = {
          week: n,
          proposalsDecided: 0,
          confirmed: 0,
          confirmationRate: null,
          itemsSaved: 0,
          corrected: 0,
          correctionRate: null,
        };
        byWeek.set(n, w);
      }
      return w;
    };
    for (const r of decided) {
      const w = at(Math.max(0, r.week));
      w.proposalsDecided += r.decided;
      w.confirmed += r.confirmed;
    }
    for (const r of saved) {
      const w = at(Math.max(0, r.week));
      w.itemsSaved += r.saved;
      w.corrected += r.corrected;
    }
    const weeks = [...byWeek.values()].sort((a, b) => a.week - b.week);
    for (const w of weeks) {
      w.confirmationRate = rate(w.confirmed, w.proposalsDecided);
      w.correctionRate = rate(w.corrected, w.itemsSaved);
    }
    const total = briefs?.briefs ?? 0;
    const unedited = total - (briefs?.edited ?? 0);
    return {
      weeks,
      briefAcceptedUnedited: { briefs: total, unedited, rate: rate(unedited, total) },
    };
  });
}

export interface MonthlyReview {
  workspaceId: string;
  preparedAt: Date;
  activeItems: number;
  pausedItems: number;
  /** Active items with no use in the last 90 days: candidates to keep, edit or delete. */
  staleItems: number;
  pendingProposals: number;
  metrics: TenureMetrics;
}

/** Prepare the monthly review of one workspace: counts and rates only, no value or key. */
export async function monthlyReview(
  deps: Pick<MemoryDeps, 'db' | 'now'>,
  workspaceId: string,
): Promise<MonthlyReview> {
  const now = nowOf(deps);
  const since = new Date(
    now.getTime() - MEMORY_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const counts = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const [row] = await tx.execute<{
      active: number;
      paused: number;
      stale: number;
      pending: number;
    }>(sql`
      select
        (select count(*) from memory_item where workspace_id = ${workspaceId}::uuid and status = 'active')::int as active,
        (select count(*) from memory_item where workspace_id = ${workspaceId}::uuid and status = 'paused')::int as paused,
        (select count(*) from memory_item i where i.workspace_id = ${workspaceId}::uuid and i.status = 'active'
           and i.updated_at < ${since}::timestamptz
           and not exists (select 1 from memory_usage u where u.workspace_id = i.workspace_id and u.item_id = i.id
                           and u.used_at >= ${since}::timestamptz))::int as stale,
        (select count(*) from memory_proposal where workspace_id = ${workspaceId}::uuid and status = 'proposed')::int as pending`);
    return row;
  });
  return {
    workspaceId,
    preparedAt: now,
    activeItems: counts?.active ?? 0,
    pausedItems: counts?.paused ?? 0,
    staleItems: counts?.stale ?? 0,
    pendingProposals: counts?.pending ?? 0,
    metrics: await computeMetrics(deps.db, workspaceId),
  };
}

/** Workspaces with memory to review (ids only, through the owner-defined function). */
export async function reviewMemoryTargets(db: Db): Promise<string[]> {
  const rows = await db.execute<{ workspace_id: string }>(
    sql`select workspace_id::text as workspace_id from app_memory_review_targets()`,
  );
  return rows.map((r) => r.workspace_id);
}

export interface MemoryReviewSummary {
  completedAt: Date;
  activeItems: number;
  pausedItems: number;
}

/** When the actor last completed the monthly review (`M1.last_memory_review`); null if never. */
export async function getLastMemoryReview(
  deps: MemoryDeps,
  actor: MemoryActor,
): Promise<Date | null> {
  await requireRole(deps, actor);
  const open = await opener(deps, actor.workspaceId);
  const [row] = await inScope(deps, actor, (tx) =>
    tx
      .select({ value: memoryItem.valueCiphertext })
      .from(memoryItem)
      .where(reviewRow(actor)),
  );
  if (row?.value == null) return null;
  const value = open(row.value);
  const at = typeof value === 'string' ? new Date(value) : null;
  return at === null || Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Record the review as done now: the date is a confirmed workspace-scope item under
 * `M1.last_memory_review` (one per member), so the screen can tell when a month has passed.
 */
export async function completeMemoryReview(
  deps: MemoryDeps,
  actor: MemoryActor,
): Promise<MemoryReviewSummary> {
  const role = await requireRole(deps, actor);
  if (!canWriteMemory(role)) throw forbidden('This role cannot change memory');
  const now = nowOf(deps);
  const sealed = await sealValue(deps, actor.workspaceId, now.toISOString());
  return inScope(deps, actor, async (tx) => {
    const [existing] = await tx.select({ id: memoryItem.id }).from(memoryItem).where(reviewRow(actor));
    if (existing) {
      await tx
        .update(memoryItem)
        .set({ valueCiphertext: sealed, updatedAt: now })
        .where(and(eq(memoryItem.workspaceId, actor.workspaceId), eq(memoryItem.id, existing.id)));
    } else {
      await tx.insert(memoryItem).values({
        workspaceId: actor.workspaceId,
        layer: 'M1',
        key: 'M1.last_memory_review',
        scope: 'workspace',
        ownerUserId: actor.userId,
        valueCiphertext: sealed,
        sourceType: 'manual',
        confirmationState: 'confirmed',
        strategy: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    const [counts] = await tx.execute<{ active: number; paused: number }>(sql`
      select
        count(*) filter (where status = 'active' and key <> 'M1.last_memory_review')::int as active,
        count(*) filter (where status = 'paused')::int as paused
      from memory_item where workspace_id = ${actor.workspaceId}::uuid`);
    return { completedAt: now, activeItems: counts?.active ?? 0, pausedItems: counts?.paused ?? 0 };
  });
}

const reviewRow = (actor: MemoryActor) =>
  and(
    eq(memoryItem.workspaceId, actor.workspaceId),
    eq(memoryItem.key, 'M1.last_memory_review'),
    eq(memoryItem.ownerUserId, actor.userId),
    eq(memoryItem.status, 'active'),
  );
