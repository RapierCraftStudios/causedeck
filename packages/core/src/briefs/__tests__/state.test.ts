import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assembleBrief, type BriefEvent } from '../assemble.ts';
import { listRefreshTargets, refreshBrief, refreshBriefTargets } from '../refresh.ts';
import { markPrepared, setBriefNote, setCarryItem, unmarkPrepared } from '../state.ts';

import { seedBrief } from './helpers.ts';

function collector() {
  const events: BriefEvent[] = [];
  return { events, port: { emit: (e: BriefEvent) => void events.push(e) } };
}

describe('brief_state', () => {
  it('persists manual carry add, tick, remove and a note across re-assembly (R4)', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture } = await seedBrief(tx);
      const deps = { db: tx };
      const listingId = fixture.listingId;
      const added = await setCarryItem(deps, actor, {
        listingId,
        action: 'add',
        label: 'Original vakalatnama',
      });
      const key = added.carry.find((c) => c.manual)?.key ?? '';
      await setCarryItem(deps, actor, { listingId, action: 'tick', key, ticked: true });
      await setBriefNote(deps, actor, { listingId, note: 'Ask for short date' });
      let brief = await assembleBrief(deps, actor, listingId);
      expect(brief.carry.find((c) => c.key === key)).toMatchObject({
        kind: 'manual',
        label: 'Original vakalatnama',
        ticked: true,
      });
      expect(brief.carry.some((c) => c.kind === 'document')).toBe(true);
      expect(brief.note).toBe('Ask for short date');
      await setCarryItem(deps, actor, { listingId, action: 'remove', key });
      brief = await assembleBrief(deps, actor, listingId);
      expect(brief.carry.some((c) => c.key === key)).toBe(false);
    });
  });

  it('records who and when, and a new obligation clears the mark with brief.stale (R8)', async () => {
    await withTestDb(async (tx) => {
      const { actor, workspaceId, ownerId, fixture } = await seedBrief(tx);
      const { events, port } = collector();
      let t = new Date('2026-10-25T09:00:00Z');
      const deps = { db: tx, events: port, now: () => t };
      const state = await markPrepared(deps, actor, { listingId: fixture.listingId });
      expect(state.prepared_by).toBe(ownerId);
      expect(state.prepared_at).toBe(t.toISOString());

      t = new Date(Date.now() + 60_000);
      await inWorkspace(tx, workspaceId, async (s) => {
        const [o] = await s
          .select()
          .from(schema.obligation)
          .where(eq(schema.obligation.id, fixture.openObligationId));
        if (o === undefined) throw new Error('obligation');
        const rest = Object.fromEntries(
          Object.entries(o).filter(([k]) => !['id', 'createdAt', 'updatedAt'].includes(k)),
        ) as Omit<typeof o, 'id' | 'createdAt' | 'updatedAt'>;
        await s
          .insert(schema.obligation)
          .values({ ...rest, description: 'new thing', createdAt: new Date(Date.now() + 5_000) });
      });
      // Re-mark between the fixture rows (created at transaction start) and the new row.
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.briefState)
          .set({ preparedAt: new Date(Date.now() + 2_000) })
          .where(eq(schema.briefState.listingId, fixture.listingId)),
      );
      const first = await refreshBrief(deps, { workspaceId, listingId: fixture.listingId });
      expect(first.stale).toBe('new_obligation');
      expect(events).toEqual([
        {
          type: 'brief.stale',
          workspaceId,
          listingId: fixture.listingId,
          reason: 'new_obligation',
        },
      ]);
      const brief = await assembleBrief(deps, actor, fixture.listingId);
      expect(brief.prepared).toBeNull();

      // Idempotent: a second run yields the same state and no duplicate event (R10).
      const second = await refreshBrief(deps, { workspaceId, listingId: fixture.listingId });
      expect(second.stale).toBeNull();
      expect(events).toHaveLength(1);
      const rows = await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.briefState));
      expect(rows).toHaveLength(1);
    });
  });

  it('sweep selects tomorrow, skips far dates, and refreshes idempotently (R10, R11)', async () => {
    await withTestDb(async (tx) => {
      const [dayRow] = await tx.execute<{ day: string }>(
        sql`select ((now() at time zone 'Asia/Kolkata')::date + 1)::text as day`,
      );
      const [farRow] = await tx.execute<{ far: string }>(
        sql`select ((now() at time zone 'Asia/Kolkata')::date + 30)::text as far`,
      );
      const day = dayRow?.day ?? '';
      const far = farRow?.far ?? '';
      const near = await seedBrief(tx, day);
      const distant = await seedBrief(tx, far);
      const targets = await listRefreshTargets(tx);
      const ids = targets.map((t) => t.listingId);
      expect(ids).toContain(near.fixture.listingId);
      expect(ids).not.toContain(distant.fixture.listingId);

      const { events, port } = collector();
      const report = await refreshBriefTargets({ db: tx, events: port });
      expect(report.failed).toBe(0);
      expect(report.refreshed).toBe(report.targets);
      const again = await refreshBriefTargets({ db: tx, events: port });
      expect(again.stale).toBe(0);
      expect(events).toHaveLength(report.stale);
    });
  });

  it('unmarkPrepared clears the mark', async () => {
    await withTestDb(async (tx) => {
      const { actor, fixture } = await seedBrief(tx);
      await markPrepared({ db: tx }, actor, { listingId: fixture.listingId });
      const state = await unmarkPrepared({ db: tx }, actor, { listingId: fixture.listingId });
      expect(state.prepared_at).toBeNull();
    });
  });

  it('rejects invalid input (R16)', async () => {
    await withTestDb(async (tx) => {
      const { actor } = await seedBrief(tx);
      await expect(markPrepared({ db: tx }, actor, { listingId: 'x' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });
  });
});
