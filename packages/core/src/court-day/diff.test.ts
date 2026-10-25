import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import type { SnapshotRow } from '@causedeck/validators';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../__tests__/fixtures.ts';

import { diffLists, hashRows, itemOrdinal, snapshotList } from './diff.ts';
import type { CourtDayEvent } from './scope.ts';

const row = (
  key: string,
  hallNo: string | null,
  itemNo: string | null,
  stage: string | null = 'FOR ORDERS',
): SnapshotRow => ({
  proceedingKey: key,
  hallNo,
  itemNo,
  stage,
});

describe('diffLists (R6)', () => {
  const prev = [row('WP/1/2026', '3', '4'), row('WP/2/2026', '3', '5'), row('WP/3/2026', '3', '6')];

  it('reports added, removed, moved and stage_changed entries', () => {
    const next = [
      row('WP/1/2026', '3', '4'),
      row('WP/2/2026', '5', '5'),
      row('WP/3/2026', '3', '6', 'FOR HEARING'),
      row('WP/4/2026', '3', '7'),
    ];
    const diff = diffLists({ rows: prev }, { rows: next });
    expect(diff.added.map((e) => e.proceedingKey)).toEqual(['WP/4/2026']);
    expect(diff.moved.map((e) => e.proceedingKey)).toEqual(['WP/2/2026']);
    expect(diff.stage_changed.map((e) => e.proceedingKey)).toEqual(['WP/3/2026']);
    expect(diff.removed).toEqual([]);
    const gone = diffLists({ rows: prev }, { rows: prev.slice(1) });
    expect(gone.removed.map((e) => e.proceedingKey)).toEqual(['WP/1/2026']);
  });

  it('treats an item number change as a move', () => {
    const diff = diffLists(
      { rows: prev },
      { rows: [row('WP/1/2026', '3', '9'), ...prev.slice(1)] },
    );
    expect(diff.moved).toHaveLength(1);
    expect(diff.moved[0]?.before?.itemNo).toBe('4');
    expect(diff.moved[0]?.after?.itemNo).toBe('9');
  });

  it('is idempotent for identical input and empty for equal lists', () => {
    const next = [row('WP/1/2026', '5', '4'), row('WP/9/2026', '3', '1')];
    expect(diffLists({ rows: prev }, { rows: next })).toEqual(
      diffLists({ rows: prev }, { rows: next }),
    );
    const same = diffLists({ rows: prev }, { rows: [...prev].reverse() });
    expect(same.entries).toEqual([]);
    expect(hashRows(prev)).toBe(hashRows([...prev].reverse()));
  });

  it('orders item numbers numerically (9 before 10)', () => {
    expect(itemOrdinal('12A')).toBe(12);
    const diff = diffLists({ rows: [] }, { rows: [row('a', '3', '10'), row('b', '3', '9')] });
    expect(diff.added.map((e) => e.after?.itemNo)).toEqual(['9', '10']);
  });
});

describe('diffLists daily against supplementary (R7)', () => {
  it('is labelled supplementary and lists new rows first', () => {
    const daily = [row('WP/1/2026', '3', '2'), row('WP/2/2026', '3', '3')];
    const supp = [
      row('WP/1/2026', '4', '2'),
      row('WP/2/2026', '3', '3'),
      row('WP/5/2026', '3', '40'),
    ];
    const diff = diffLists(
      { rows: daily, listType: 'daily' },
      { rows: supp, listType: 'supplementary' },
    );
    expect(diff.label).toBe('supplementary');
    expect(diff.entries.map((e) => e.kind)).toEqual(['added', 'moved']);
    expect(diffLists({ rows: daily }, { rows: supp }).label).toBe('changed');
  });
});

describe('snapshotList (R6, R7)', () => {
  it('stores immutable snapshots, diffs against the previous one and emits once per change', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
      const events: CourtDayEvent[] = [];
      const deps = { db: tx, events: { emit: (e: CourtDayEvent) => events.push(e) } };
      const actor = { userId: ownerId, workspaceId };
      const base = { forumId: forum.id, listDate: '2026-11-02' };
      const daily = [row('WP/1/2026', '3', '2'), row('WP/2/2026', '3', '3')];

      const first = await snapshotList(deps, actor, { ...base, listType: 'daily', rows: daily });
      expect(first).toMatchObject({ created: true, diff: null });
      expect(first.contentHash).toBe(hashRows(daily));

      const again = await snapshotList(deps, actor, {
        ...base,
        listType: 'daily',
        rows: [...daily].reverse(),
      });
      expect(again).toMatchObject({ created: false, snapshotId: first.snapshotId });
      expect(events).toEqual([]);

      const supp = await snapshotList(deps, actor, {
        ...base,
        listType: 'supplementary',
        rows: [...daily, row('WP/9/2026', '4', '31')],
      });
      expect(supp.created).toBe(true);
      expect(supp.diff?.label).toBe('supplementary');
      expect(supp.diff?.added.map((e) => e.proceedingKey)).toEqual(['WP/9/2026']);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'court_day.list_changed',
        previousSnapshotId: first.snapshotId,
        label: 'supplementary',
        added: 1,
      });

      const stored = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.listSnapshot),
      );
      expect(stored).toHaveLength(2);
      await expect(
        inWorkspace(tx, workspaceId, (s) =>
          s
            .update(schema.listSnapshot)
            .set({ rows: [] })
            .where(eq(schema.listSnapshot.id, first.snapshotId)),
        ),
      ).rejects.toBeDefined();
    });
  });

  it('refuses an unknown forum', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      await expect(
        snapshotList(
          { db: tx },
          { userId: ownerId, workspaceId },
          {
            forumId: '00000000-0000-4000-8000-000000000000',
            listDate: '2026-11-02',
            listType: 'daily',
            rows: [],
          },
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
