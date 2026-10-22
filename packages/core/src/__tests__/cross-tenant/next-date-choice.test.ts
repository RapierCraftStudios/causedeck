// Cross-tenant next-date conflict resolution (#390): user `ub`, working in workspace B, calls
// `chooseNextDateSource` with workspace A's listings: A's seeded canonical listing and a
// conflicting proposal added in A's scope. Every choice, claiming A or from B, must be NOT_FOUND,
// FORBIDDEN or VALIDATION (`denies`), emit nothing and leave every listing of A unchanged; A's own
// owner can still resolve the card, so the probe is sound. Kept beside services.test.ts and driven
// by the same registry (`@causedeck/db/testing/cross-tenant-registry`), like rosters.test.ts.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/next-date-choice.test.ts';

interface Fixture extends TwoTenants {
  tx: Transaction;
  /** Run `fn` as `ub` inside workspace B's scope. */
  asB: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
  /** A's canonical listing and the conflicting proposal. */
  currentListingId: string;
  proposedListingId: string;
}

type Case = (f: Fixture) => Promise<void>;

/** Rejects with a WorkspaceError whose code is NOT_FOUND, FORBIDDEN or VALIDATION. */
async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected NOT_FOUND, FORBIDDEN or VALIDATION').toBeInstanceOf(core.WorkspaceError);
  expect(['NOT_FOUND', 'FORBIDDEN', 'VALIDATION']).toContain((error as core.WorkspaceError).code);
}

/** Every listing of A, all columns, for before/after checks. */
async function aListings(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, (s) =>
    s
      .select()
      .from(schema.listing)
      .where(eq(schema.listing.workspaceId, f.a.id))
      .orderBy(schema.listing.id),
  );
}

function graphDeps(db: Database | Transaction) {
  const events: core.GraphEvent[] = [];
  return { deps: { db, events: { emit: (e: core.GraphEvent) => events.push(e) } }, events };
}

const CHOICES = [
  { choice: 'current' },
  { choice: 'proposed' },
  { choice: 'manual', date: '2099-01-05' },
] as const;

const CASES: Record<string, Case> = {
  chooseNextDateSource: async (f) => {
    const before = await aListings(f);
    const ids = { currentListingId: f.currentListingId, proposedListingId: f.proposedListingId };
    for (const choice of CHOICES) {
      const input = { ...ids, ...choice };
      const { deps, events } = graphDeps(f.tx);
      // ub claiming A: no scope, and from B's scope.
      await expectDenied(
        core.chooseNextDateSource(deps, { userId: f.ub, workspaceId: f.a.id }, input),
      );
      await expectDenied(
        f.asB((s) =>
          core.chooseNextDateSource(
            { ...deps, db: s },
            { userId: f.ub, workspaceId: f.a.id },
            input,
          ),
        ),
      );
      // ub in B with A's listing ids: not visible.
      await expectDenied(
        core.chooseNextDateSource(deps, { userId: f.ub, workspaceId: f.b.id }, input),
      );
      expect(events).toEqual([]);
    }
    expect(await aListings(f)).toEqual(before);
    // A's own owner resolves it: the probe is sound.
    const { deps } = graphDeps(f.tx);
    const row = await core.chooseNextDateSource(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { ...ids, choice: 'current' },
    );
    expect(row.id).toBe(f.currentListingId);
  },
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant next-date conflict resolution: ub on workspace B against A (#390)', () => {
  it('has a case for every service the registry points here', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((name) => !(name in CASES))).toEqual([]);
    expect(Object.keys(CASES).filter((name) => !registered.includes(name))).toEqual([]);
  });

  it.each(registered)('%s', async (name) => {
    const run = CASES[name];
    if (run === undefined) throw new Error(`no cross-tenant case for ${name}`);
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const currentListingId = seeded.a.rows.listing?.listingId;
      if (currentListingId === undefined) throw new Error('two-tenant listing seed missing');
      const proposedListingId = await inWorkspace(tx, seeded.a.id, async (s) => {
        const [current] = await s
          .select()
          .from(schema.listing)
          .where(eq(schema.listing.id, currentListingId));
        if (current === undefined) throw new Error("A's listing not found");
        const [row] = await s
          .insert(schema.listing)
          .values({
            workspaceId: seeded.a.id,
            proceedingId: current.proceedingId,
            listDate: '2099-01-12',
            listType: 'daily',
            stageRaw: '',
            sourceType: 'adapter',
            sourceRef: 'cause-list:probe',
            confirmationState: 'proposed',
          })
          .returning({ id: schema.listing.id });
        if (row === undefined) throw new Error('proposal insert returned no row');
        return row.id;
      });
      await run({
        ...seeded,
        tx,
        asB: (fn) => inWorkspace(tx, seeded.b.id, fn, seeded.ub),
        currentListingId,
        proposedListingId,
      });
    });
  });
});
