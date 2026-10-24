// List snapshots and their diff (#58). `snapshotList` stores one immutable row per list ingestion
// (hash plus rows) from a list the lawyer supplied or forwarded: nothing here fetches a list.
// `diffLists` is pure: it compares two row sets by proceeding key and is idempotent for identical
// input. Item numbers stay text as printed and sort numerically (9 before 10).
import { createHash } from 'node:crypto';

import { schema } from '@causedeck/db';
import {
  ListDiff,
  SnapshotListInput,
  type ListDiffEntry,
  type SnapshotRow,
} from '@causedeck/validators';
import { and, desc, eq, sql } from 'drizzle-orm';

import { notFound } from '../shared/errors.ts';

import {
  inCourtDayScope,
  parseInput,
  requireAction,
  type CourtDayActor,
  type CourtDayDeps,
} from './scope.ts';

const { listSnapshot, forum } = schema;

type ListKind = 'daily' | 'advance' | 'supplementary' | 'special';

/** One side of a diff: its rows and, when known, its list type. */
export interface DiffSide {
  rows: readonly SnapshotRow[];
  listType?: ListKind;
}

/** The numeric part of an item number as printed ("12A" is 12); null sorts last. */
export function itemOrdinal(itemNo: string | null): number | null {
  if (itemNo === null) return null;
  const match = /\d+/.exec(itemNo);
  return match === null ? null : Number(match[0]);
}

function compareItems(a: SnapshotRow | null, b: SnapshotRow | null): number {
  const x = itemOrdinal(a?.itemNo ?? null);
  const y = itemOrdinal(b?.itemNo ?? null);
  if (x !== y) return x === null ? 1 : y === null ? -1 : x - y;
  return (a?.itemNo ?? '').localeCompare(b?.itemNo ?? '');
}

function sameRow(a: SnapshotRow, b: SnapshotRow): boolean {
  return a.hallNo === b.hallNo && a.itemNo === b.itemNo && a.stage === b.stage;
}

function byKey(rows: readonly SnapshotRow[]): Map<string, SnapshotRow> {
  const map = new Map<string, SnapshotRow>();
  for (const row of rows) if (!map.has(row.proceedingKey)) map.set(row.proceedingKey, row);
  return map;
}

/**
 * What changed from `prev` to `next`: `added` and `removed` proceedings, `moved` (hall or item
 * changed) and `stage_changed` (a row whose hall and item changed too appears in both). A daily list
 * compared with its later supplementary list is labelled `supplementary` and lists new rows first.
 */
export function diffLists(prev: DiffSide, next: DiffSide): ListDiff {
  const before = byKey(prev.rows);
  const after = byKey(next.rows);
  const entry = (
    kind: ListDiffEntry['kind'],
    proceedingKey: string,
    b: SnapshotRow | null,
    a: SnapshotRow | null,
  ): ListDiffEntry => ({ kind, proceedingKey, before: b, after: a });

  const added: ListDiffEntry[] = [];
  const removed: ListDiffEntry[] = [];
  const moved: ListDiffEntry[] = [];
  const stageChanged: ListDiffEntry[] = [];
  for (const [key, row] of after) {
    const old = before.get(key);
    if (old === undefined) {
      added.push(entry('added', key, null, row));
      continue;
    }
    if (old.hallNo !== row.hallNo || old.itemNo !== row.itemNo) {
      moved.push(entry('moved', key, old, row));
    }
    if (old.stage !== row.stage) stageChanged.push(entry('stage_changed', key, old, row));
  }
  for (const [key, row] of before) {
    if (!after.has(key)) removed.push(entry('removed', key, row, null));
  }
  const order = (a: ListDiffEntry, b: ListDiffEntry): number =>
    compareItems(a.after ?? a.before, b.after ?? b.before) ||
    a.proceedingKey.localeCompare(b.proceedingKey);
  for (const list of [added, removed, moved, stageChanged]) list.sort(order);

  const supplementary = prev.listType === 'daily' && next.listType === 'supplementary';
  const entries = supplementary
    ? [...added, ...removed, ...moved, ...stageChanged]
    : [...added, ...removed, ...moved, ...stageChanged].sort(order);
  return {
    label: supplementary ? 'supplementary' : 'changed',
    added,
    removed,
    moved,
    stage_changed: stageChanged,
    entries,
  };
}

/** The hash of a row set: sha256 of its canonical JSON, independent of row order. */
export function hashRows(rows: readonly SnapshotRow[]): string {
  const canonical = [...rows]
    .sort((a, b) => a.proceedingKey.localeCompare(b.proceedingKey))
    .map((r) => [r.proceedingKey, r.hallNo, r.itemNo, r.stage]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface SnapshotResult {
  snapshotId: string;
  contentHash: string;
  /** False when the same list was stored before: nothing new is written. */
  created: boolean;
  /** Against the previous snapshot of the same forum and date; null for the first. */
  diff: ListDiff | null;
}

/**
 * Store an immutable snapshot of a list the lawyer supplied or forwarded. Storing the same rows again
 * returns the earlier snapshot. A new snapshot is diffed against the previous one of the forum and
 * date (a supplementary list against the daily one) and emits `court_day.list_changed` through the
 * injected port. Needs `matter.write`.
 */
export async function snapshotList(
  deps: CourtDayDeps,
  actor: CourtDayActor,
  input: SnapshotListInput,
): Promise<SnapshotResult> {
  const data = parseInput(SnapshotListInput, input);
  const contentHash = hashRows(data.rows);
  return inCourtDayScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId } = scope.actor;
    requireAction(scope, 'matter.write', await scope.settings(), 'You cannot store a list');
    const [known] = await tx
      .select({ id: forum.id })
      .from(forum)
      .where(eq(forum.id, data.forumId))
      .limit(1);
    if (known === undefined) throw notFound('Forum not found');

    const same = and(
      eq(listSnapshot.workspaceId, workspaceId),
      eq(listSnapshot.forumId, data.forumId),
      eq(listSnapshot.listDate, data.listDate),
    );
    const [previous] = await tx
      .select({
        id: listSnapshot.id,
        rows: listSnapshot.rows,
        listType: listSnapshot.listType,
      })
      .from(listSnapshot)
      .where(same)
      .orderBy(desc(listSnapshot.createdAt), desc(listSnapshot.id))
      .limit(1);
    const inserted = await tx
      .insert(listSnapshot)
      .values({
        workspaceId,
        forumId: data.forumId,
        listDate: data.listDate,
        listType: data.listType,
        contentHash,
        rows: data.rows,
        createdAt: sql`clock_timestamp()`,
        sourceCaptureId: data.sourceCaptureId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: listSnapshot.id });
    const created = inserted[0];
    if (created === undefined) {
      const [existing] = await tx
        .select({ id: listSnapshot.id })
        .from(listSnapshot)
        .where(
          and(same, eq(listSnapshot.listType, data.listType), eq(listSnapshot.contentHash, contentHash)),
        )
        .limit(1);
      if (existing === undefined) throw new Error('snapshotList: conflict without a stored row');
      return { snapshotId: existing.id, contentHash, created: false, diff: null };
    }

    const diff =
      previous === undefined
        ? null
        : diffLists(
            { rows: previous.rows, listType: previous.listType },
            { rows: data.rows, listType: data.listType },
          );
    if (diff !== null && diff.entries.length > 0) {
      scope.emit({
        type: 'court_day.list_changed',
        workspaceId,
        forumId: data.forumId,
        listDate: data.listDate,
        listType: data.listType,
        snapshotId: created.id,
        previousSnapshotId: previous?.id ?? null,
        label: diff.label,
        added: diff.added.length,
        removed: diff.removed.length,
        moved: diff.moved.length,
        stageChanged: diff.stage_changed.length,
      });
    }
    return { snapshotId: created.id, contentHash, created: true, diff };
  });
}
