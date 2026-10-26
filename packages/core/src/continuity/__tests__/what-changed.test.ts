import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { changesForViewer, recordView, whatChangedSince } from '../index.ts';

import { NOW, seedContinuity } from './helpers.ts';

describe('recordView (R5)', () => {
  it('debounces to one write per 30 s and keeps the first-ever view cardless', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture, workspaceId } = await seedContinuity(tx);
      const first = await changesForViewer(deps, actor, { matterId: fixture.matterId });
      expect(first.summary).toBeNull();
      expect(first.marker.previous_viewed_at).toBeNull();
      expect(first.marker.recorded).toBe(true);
      const soon = { ...deps, now: () => new Date(NOW.getTime() + 10_000) };
      const repeat = await recordView(soon, actor, { matterId: fixture.matterId });
      expect(repeat.recorded).toBe(false);
      expect(repeat.viewed_at).toBe(NOW.toISOString());
      const later = { ...deps, now: () => new Date(NOW.getTime() + 31_000) };
      const next = await recordView(later, actor, { matterId: fixture.matterId });
      expect(next.recorded).toBe(true);
      const rows = await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.matterView));
      expect(rows).toHaveLength(1);
    });
  });

  it('shows the days since the last view and the changes after it', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture } = await seedContinuity(tx);
      const past = { ...deps, now: () => new Date(NOW.getTime() - 12 * 86_400_000) };
      await recordView(past, actor, { matterId: fixture.matterId });
      const card = await changesForViewer(deps, actor, { matterId: fixture.matterId });
      expect(card.summary?.days_ago).toBe(12);
      expect(card.marker.previous_viewed_at).toBe(past.now().toISOString());
    });
  });
});

describe('whatChangedSince (R4)', () => {
  it('groups new rows chronologically by day, each with provenance', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture } = await seedContinuity(tx);
      const summary = await whatChangedSince(deps, actor, fixture.matterId, new Date(0));
      expect(summary.total).toBeGreaterThan(0);
      const kinds = new Set(summary.groups.flatMap((g) => g.items.map((i) => i.kind)));
      expect(kinds.has('order')).toBe(true);
      expect(kinds.has('listing')).toBe(true);
      expect(kinds.has('document')).toBe(true);
      const days = summary.groups.map((g) => g.day);
      expect([...days].sort()).toEqual(days);
      for (const item of summary.groups.flatMap((g) => g.items)) {
        expect(item.line.source_type).toBeTruthy();
      }
    });
  });

  it('is empty when nothing is newer than the marker', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture } = await seedContinuity(tx);
      const summary = await whatChangedSince(
        deps,
        actor,
        fixture.matterId,
        new Date(NOW.getTime() + 86_400_000),
      );
      expect(summary.total).toBe(0);
      expect(summary.groups).toEqual([]);
    });
  });
});
