// The preparedness tap (#86) on the test database: one rating per appearance and member, updated by
// a second tap, baseline tagging, viewer denied, only the member's own appearance, own-data deletion.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { failure } from '../../__tests__/fixtures.ts';
import { deleteOwnRating, listPov, recordPreparedness, recordSkip } from '../index.ts';

import { NOW, povWorld } from './helpers.ts';

describe('recordPreparedness', () => {
  it('stores a rating and a second tap updates it, tagged baseline in the first 7 days', async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx);
      const deps = { db: tx, now: () => NOW };
      const hearingId = w.hearings[0] as string;
      await recordPreparedness(deps, w.owner, { hearingId, rating: 2, note: 'rushed' });
      await recordPreparedness(deps, w.owner, { hearingId, rating: 5 });
      const rows = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.preparednessRating),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ rating: 5, note: null, baseline: true, skippedAt: null });
    });
  });

  it('a skip then a tap replaces the skip; a skip is not a rating', async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx);
      const deps = { db: tx, now: () => NOW };
      const hearingId = w.hearings[0] as string;
      await recordSkip(deps, w.owner, { hearingId });
      expect((await listPov(deps, w.owner)).ratings[0]).toMatchObject({
        skipped: true,
        rating: null,
      });
      await recordPreparedness(deps, w.owner, { hearingId, rating: 3 });
      expect((await listPov(deps, w.owner)).ratings[0]).toMatchObject({
        skipped: false,
        rating: 3,
      });
    });
  });

  it('denies a viewer and a member without an appearance at the hearing', async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx);
      const deps = { db: tx, now: () => NOW };
      const hearingId = w.hearings[0] as string;
      const viewer = (await failure(
        recordPreparedness(deps, w.viewer, { hearingId, rating: 3 }),
      )) as { code: string };
      expect(viewer.code).toBe('FORBIDDEN');
      await inWorkspace(tx, w.workspaceId, (s) => s.delete(schema.appearance));
      const none = (await failure(recordPreparedness(deps, w.owner, { hearingId, rating: 3 }))) as {
        code: string;
      };
      expect(none.code).toBe('NOT_FOUND');
    });
  });

  it("a member reads and deletes their own rating, not another member's", async () => {
    await withTestDb(async (tx) => {
      const w = await povWorld(tx);
      const deps = { db: tx, now: () => NOW };
      const hearingId = w.hearings[0] as string;
      await recordPreparedness(deps, w.owner, { hearingId, rating: 4 });
      const mine = await recordPreparedness(deps, w.advocate, { hearingId, rating: 1 });
      const denied = (await failure(deleteOwnRating(deps, w.owner, { ratingId: mine.id }))) as {
        code: string;
      };
      expect(denied.code).toBe('NOT_FOUND');
      await deleteOwnRating(deps, w.advocate, { ratingId: mine.id });
      expect((await listPov(deps, w.advocate)).ratings).toEqual([]);
      expect((await listPov(deps, w.owner)).ratings).toHaveLength(1);
    });
  });
});
