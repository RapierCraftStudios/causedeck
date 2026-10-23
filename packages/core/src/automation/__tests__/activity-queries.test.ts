// The activity feed read model (#49): newest first, keyset paging, the filters and the search, what
// a member without access to a matter does not see, the role limits (viewer, clerk), the counts
// per IST day, the end-of-day digest counts (sensitive and unreadable matters left out) and the
// export (owners the workspace, everyone else their own, audited).
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { addMember } from '../../__tests__/fixtures.ts';
import {
  countByDay,
  countDigestActivities,
  exportActivities,
  getActivityDetail,
  listActivities,
  restrictMatter,
  setSensitive,
  WorkspaceError,
} from '../../index.ts';

import { NOW, rows, world, type World } from './world.ts';

const DAY = 24 * 60 * 60 * 1000;
const CAPTURE = '00000000-0000-4000-8000-0000000000c1';

type NewActivity = Partial<typeof schema.activity.$inferInsert> & { summary: string };

/** Insert activities for the workspace; `createdAt` defaults to the fixed clock, undo window 7 days. */
async function seed(w: World, values: NewActivity[]): Promise<string[]> {
  const inserted = await inWorkspace(w.tx, w.workspaceId, (s) =>
    s
      .insert(schema.activity)
      .values(
        values.map((v) => {
          const createdAt = v.createdAt ?? NOW;
          return {
            workspaceId: w.workspaceId,
            kind: 'task',
            level: 'L3' as const,
            actor: 'system' as const,
            undoExpiresAt: new Date(createdAt.getTime() + 7 * DAY),
            ...v,
            createdAt,
          };
        }),
      )
      .returning({ id: schema.activity.id }),
  );
  return inserted.map((r) => r.id);
}

const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000);

describe('listActivities', () => {
  it('lists newest first and pages by keyset without gaps or repeats, ties included', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const ids = await seed(w, [
        { summary: 'one', createdAt: at(50) },
        { summary: 'two', createdAt: at(40) },
        { summary: 'tie a', createdAt: at(30) },
        { summary: 'tie b', createdAt: at(30) },
        { summary: 'five', createdAt: at(10) },
      ]);
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await listActivities(w.deps, w.owner, { limit: 2, cursor });
        seen.push(...page.items.map((i) => i.id));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor !== undefined);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(5);
      expect(seen.sort()).toEqual([...ids].sort());
      const first = await listActivities(w.deps, w.owner);
      expect(first.items.map((i) => i.summary)).toEqual([
        'five',
        expect.any(String),
        expect.any(String),
        'two',
        'one',
      ]);
      expect(first.nextCursor).toBeNull();
    });
  });

  it('rejects a malformed cursor and an inverted range', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await expect(listActivities(w.deps, w.owner, { cursor: 'nope' })).rejects.toBeInstanceOf(
        WorkspaceError,
      );
      await expect(
        listActivities(w.deps, w.owner, { from: at(1), to: at(5) }),
      ).rejects.toBeInstanceOf(WorkspaceError);
    });
  });

  it('filters by level, kind, capture, matter and date range', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await seed(w, [
        { summary: 'auto task', level: 'L3', kind: 'task', createdAt: at(60) },
        { summary: 'confirmed attach', level: 'L2', kind: 'document_attach', createdAt: at(50) },
        { summary: 'captured', level: 'L1', kind: 'new_matter', createdAt: at(40) },
        {
          summary: 'from capture',
          captureId: CAPTURE,
          entityRefs: { matterId: w.matterId },
          createdAt: at(30),
        },
      ]);
      const summaries = async (f: Parameters<typeof listActivities>[2]) =>
        (await listActivities(w.deps, w.owner, f)).items.map((i) => i.summary);
      expect(await summaries({ level: 'L2' })).toEqual(['confirmed attach']);
      expect(await summaries({ kind: 'new_matter' })).toEqual(['captured']);
      expect(await summaries({ captureId: CAPTURE })).toEqual(['from capture']);
      expect(await summaries({ matterId: w.matterId })).toEqual(['from capture']);
      expect(await summaries({ matterId: w.otherMatterId })).toEqual([]);
      expect(await summaries({ from: at(45), to: at(35) })).toEqual(['captured']);
    });
  });

  it('searches the summaries and treats % and _ literally', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await seed(w, [
        { summary: 'Matched 100% of the case number', createdAt: at(3) },
        { summary: 'Matched 1000 of the case number', createdAt: at(2) },
        { summary: 'Created task for the clerk', createdAt: at(1) },
      ]);
      const hits = async (q: string) =>
        (await listActivities(w.deps, w.owner, { q })).items.map((i) => i.summary);
      expect(await hits('100%')).toEqual(['Matched 100% of the case number']);
      expect(await hits('CLERK')).toEqual(['Created task for the clerk']);
      expect(await hits('_')).toEqual([]);
    });
  });

  it('marks an L3 action nobody confirmed inside its window as undoable, and nothing else', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await seed(w, [
        { summary: 'open', createdAt: at(1) },
        { summary: 'confirmed', confirmedAt: NOW, confirmedBy: w.ownerId, createdAt: at(2) },
        { summary: 'undone', undoneAt: NOW, undoneBy: w.ownerId, createdAt: at(3) },
        { summary: 'expired', createdAt: new Date(NOW.getTime() - 8 * DAY) },
        { summary: 'proposal accepted', level: 'L2', createdAt: at(4) },
      ]);
      const page = await listActivities(w.deps, w.owner);
      const undoable: Record<string, boolean> = {};
      for (const item of page.items) undoable[item.summary ?? ''] = item.undoable;
      expect(undoable).toEqual({
        open: true,
        confirmed: false,
        undone: false,
        expired: false,
        'proposal accepted': false,
      });
      expect(page.canUndo).toBe(true);
    });
  });

  it('hides the detail of a matter the member may not read, and keeps the row', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      await restrictMatter(tx, w.owner, { matterId: w.matterId, allowedUserIds: [w.ownerId] });
      await seed(w, [
        {
          summary: 'Attached the order to the restricted matter',
          entityRefs: { matterId: w.matterId },
          confidence: '0.930',
          source: {
            input: 'document',
            aiCall: { model: 'm', modelVersion: '1', region: 'ap-south-1' },
          },
          createdAt: at(2),
        },
        { summary: 'Plain task', createdAt: at(1) },
      ]);
      const member = { userId: advocate, workspaceId: w.workspaceId };
      const seenByMember = (await listActivities(w.deps, member)).items;
      const hidden = seenByMember.find((i) => i.redacted);
      expect(seenByMember).toHaveLength(2);
      expect(hidden).toMatchObject({
        summary: null,
        matterId: null,
        matterTitle: null,
        model: null,
        region: null,
        confidence: null,
        inputSource: null,
      });
      const seenByOwner = (await listActivities(w.deps, w.owner)).items;
      expect(seenByOwner.find((i) => i.redacted)).toBeUndefined();
      expect(seenByOwner.find((i) => i.model === 'm')).toMatchObject({
        region: 'ap-south-1',
        matterTitle: 'Ilango v. State (fictional)',
      });
    });
  });

  it('lets a viewer read but not undo, and a clerk see only the kinds a clerk may act on', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      const clerk = await addMember(tx, w.workspaceId, 'clerk');
      await seed(w, [
        { summary: 'a task', kind: 'task', createdAt: at(3) },
        { summary: 'a next date', kind: 'next_date', createdAt: at(2) },
        { summary: 'an attach', kind: 'document_attach', createdAt: at(1) },
      ]);
      const asViewer = await listActivities(w.deps, { userId: viewer, workspaceId: w.workspaceId });
      expect(asViewer.items).toHaveLength(3);
      expect(asViewer.canUndo).toBe(false);
      expect(asViewer.items.every((i) => !i.undoable)).toBe(true);
      const asClerk = await listActivities(w.deps, { userId: clerk, workspaceId: w.workspaceId });
      expect(asClerk.items.map((i) => i.kind).sort()).toEqual(['document_attach', 'task']);
      const none = await listActivities(
        w.deps,
        { userId: clerk, workspaceId: w.workspaceId },
        { kind: 'next_date' },
      );
      expect(none.items).toEqual([]);
    });
  });
});

describe('getActivityDetail', () => {
  it('returns one activity, and NOT_FOUND for another workspace or a kind a clerk cannot see', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const clerk = await addMember(tx, w.workspaceId, 'clerk');
      const [id] = await seed(w, [{ summary: 'a next date', kind: 'next_date' }]);
      expect(await getActivityDetail(w.deps, w.owner, { activityId: id ?? '' })).toMatchObject({
        id,
        kind: 'next_date',
      });
      await expect(
        getActivityDetail(
          w.deps,
          { userId: clerk, workspaceId: w.workspaceId },
          { activityId: id ?? '' },
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const other = await world(tx);
      await expect(
        getActivityDetail(other.deps, other.owner, { activityId: id ?? '' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('countByDay', () => {
  it('counts per IST day: 23:30 and 00:30 IST are different days', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await seed(w, [
        { summary: 'late', createdAt: new Date('2026-10-20T18:00:00Z') },
        { summary: 'after midnight', createdAt: new Date('2026-10-20T19:00:00Z') },
        { summary: 'same day', level: 'L2', createdAt: new Date('2026-10-20T20:00:00Z') },
      ]);
      const days = await countByDay(w.deps, w.owner, {
        from: new Date('2026-10-19T00:00:00Z'),
        to: new Date('2026-10-22T00:00:00Z'),
      });
      expect(days).toEqual([
        { day: '2026-10-21', total: 2, l1: 0, l2: 1, l3: 1 },
        { day: '2026-10-20', total: 1, l1: 0, l2: 0, l3: 1 },
      ]);
    });
  });
});

describe('countDigestActivities', () => {
  it('counts what is still undoable, leaves out sensitive and restricted matters, names only on request', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      await setSensitive(w.deps, w.owner, { matterId: w.otherMatterId, sensitive: true });
      await seed(w, [
        { summary: 'counted', entityRefs: { matterId: w.matterId }, createdAt: at(10) },
        { summary: 'no matter', createdAt: at(9) },
        { summary: 'sensitive', entityRefs: { matterId: w.otherMatterId }, createdAt: at(8) },
        { summary: 'undone', undoneAt: NOW, createdAt: at(7) },
        { summary: 'confirmed', confirmedAt: NOW, createdAt: at(6) },
        { summary: 'a proposal', level: 'L2', createdAt: at(5) },
        { summary: 'yesterday', createdAt: new Date(NOW.getTime() - DAY) },
      ]);
      const window = {
        from: new Date(NOW.getTime() - 6 * 60 * 60_000),
        to: new Date(NOW.getTime() + 1),
      };
      const counts = await countDigestActivities(w.deps, w.owner, window);
      expect(counts).toEqual({ l3Count: 2, pendingL2Count: 0, matterTitles: [] });
      const named = await countDigestActivities(w.deps, w.owner, { ...window, includeNames: true });
      expect(named.matterTitles).toEqual(['Ilango v. State (fictional)']);

      await restrictMatter(tx, w.owner, { matterId: w.matterId, allowedUserIds: [w.ownerId] });
      const forAdvocate = await countDigestActivities(
        w.deps,
        { userId: advocate, workspaceId: w.workspaceId },
        window,
      );
      expect(forAdvocate.l3Count).toBe(1);
    });
  });
});

describe('exportActivities', () => {
  it('exports the workspace for an owner and only their own for a member, and audits it', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const advocate = await addMember(tx, w.workspaceId, 'advocate');
      await seed(w, [
        { summary: 'system action', createdAt: at(3) },
        { summary: 'their own', actor: 'user', actorUserId: advocate, createdAt: at(2) },
        { summary: 'undone by them', undoneAt: NOW, undoneBy: advocate, createdAt: at(1) },
      ]);
      const asOwner = await exportActivities(w.deps, w.owner);
      expect(asOwner.map((r) => r.summary).sort()).toEqual([
        'system action',
        'their own',
        'undone by them',
      ]);
      const asMember = await exportActivities(w.deps, {
        userId: advocate,
        workspaceId: w.workspaceId,
      });
      expect(asMember.map((r) => r.summary).sort()).toEqual(['their own', 'undone by them']);
      expect(asMember[0]).toHaveProperty('undo_expires_at');
      const audited = await rows.audit(w, 'audit.exported');
      expect(audited).toHaveLength(2);
      expect(audited.map((a) => a.metadata)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ scope: 'activity', rows: 3, whole_workspace: true }),
          expect.objectContaining({ scope: 'activity', rows: 2, whole_workspace: false }),
        ]),
      );
    });
  });
});
