import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildForum,
  buildListing,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { failure, newWorkspace, sqlState } from '../__tests__/fixtures.ts';
import { confirmNextDate, type MatterGraphDeps } from '../matter-graph/index.ts';

import { listConflictCards, proposeCourtDayNextDate } from './next-date.ts';

async function seed(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const ids = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const m = await buildMatter(s, workspaceId);
    const p = await buildProceeding(s, workspaceId, { matterId: m.id, forumId: forum.id });
    return { matterId: m.id, proceedingId: p.id, forumId: forum.id };
  });
  const deps: MatterGraphDeps = { db: tx, events: { emit: () => undefined } };
  return { ownerId, workspaceId, deps, actor: { userId: ownerId, workspaceId }, ...ids };
}

const manual = { sourceType: 'manual' as const };

describe('proposeCourtDayNextDate and listConflictCards (R9)', () => {
  it('stores a proposal, and a disagreeing one is a conflict card that leaves the confirmed date alone', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, proceedingId, matterId, workspaceId } = await seed(tx);
      const first = await proposeCourtDayNextDate(deps, actor, {
        proceedingId,
        date: '2099-03-02',
        provenance: manual,
      });
      expect(first.kind).toBe('proposal');
      if (first.kind !== 'proposal') throw new Error('expected a proposal');
      const confirmed = await confirmNextDate(deps, actor, { listingId: first.listingId });
      expect(confirmed.canonical).toBe(true);

      const clash = await proposeCourtDayNextDate(deps, actor, {
        proceedingId,
        date: '2099-04-06',
        provenance: { sourceType: 'adapter', sourceRef: 'cause-list:2099-04-06' },
      });
      expect(clash.kind).toBe('conflict');
      if (clash.kind === 'conflict') {
        expect(clash.current.date).toBe('2099-03-02');
        expect(clash.proposed.date).toBe('2099-04-06');
        expect(clash.proposed.canonical).toBe(false);
      }

      const cards = await listConflictCards(deps, actor, { matterId });
      expect(cards).toHaveLength(1);
      expect(cards[0]?.current.date).toBe('2099-03-02');
      expect(cards[0]?.proposed.date).toBe('2099-04-06');

      const canonical = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.listing)
          .where(
            and(eq(schema.listing.proceedingId, proceedingId), eq(schema.listing.canonical, true)),
          ),
      );
      expect(canonical.map((l) => l.listDate)).toEqual(['2099-03-02']);

      const same = await proposeCourtDayNextDate(deps, actor, {
        proceedingId,
        date: '2099-03-02',
        provenance: manual,
      });
      expect(same.kind).toBe('noop');
    });
  });
});

describe('one canonical listing per proceeding (R10)', () => {
  it('rejects a second canonical row with a unique violation', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, proceedingId } = await seed(tx);
      await inWorkspace(tx, workspaceId, (s) =>
        buildListing(s, workspaceId, { proceedingId, listDate: '2099-03-02', canonical: true }),
      );
      const error = await failure(
        inWorkspace(tx, workspaceId, (s) =>
          s.transaction((nested) =>
            buildListing(nested, workspaceId, {
              proceedingId,
              listDate: '2099-03-09',
              canonical: true,
            }),
          ),
        ),
      );
      expect(sqlState(error)).toBe('23505');
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.listing).where(eq(schema.listing.proceedingId, proceedingId)),
      );
      expect(rows.filter((l) => l.canonical)).toHaveLength(1);
    });
  });
});
