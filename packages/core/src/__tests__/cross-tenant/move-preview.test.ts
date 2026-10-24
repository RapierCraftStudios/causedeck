// Cross-tenant merge and split previews (#392): user `ub`, working in workspace B, previews a
// merge or split of workspace A's matters and proceedings: claiming A, from B's scope, and from
// B with A's ids. Every call must be NOT_FOUND or FORBIDDEN (`denies`); a call naming one matter
// or proceeding of each workspace is the typed `CrossWorkspaceError`. Nothing is emitted and A's
// graph is unchanged; A's own owner gets a preview, so the probe is sound. Kept beside
// services.test.ts and driven by the same registry, like next-date-choice.test.ts.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/move-preview.test.ts';

interface Fixture extends TwoTenants {
  tx: Transaction;
  /** Run `fn` as `ub` inside workspace B's scope. */
  asB: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
}

type Case = (f: Fixture) => Promise<void>;

/** Rejects with a WorkspaceError whose code is NOT_FOUND or FORBIDDEN. */
async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected NOT_FOUND or FORBIDDEN').toBeInstanceOf(core.WorkspaceError);
  expect(['NOT_FOUND', 'FORBIDDEN']).toContain((error as core.WorkspaceError).code);
}

/** A workspace's matters, proceedings, documents and obligations, for before/after checks. */
async function graphOf(f: Fixture, workspaceId: string) {
  return inWorkspace(f.tx, workspaceId, async (s) => ({
    matters: await s.select().from(schema.matter).orderBy(schema.matter.id),
    proceedings: await s.select().from(schema.proceeding).orderBy(schema.proceeding.id),
    links: await s.select().from(schema.proceedingLink).orderBy(schema.proceedingLink.id),
    documents: await s.select().from(schema.document).orderBy(schema.document.id),
    obligations: await s.select().from(schema.obligation).orderBy(schema.obligation.id),
  }));
}

/** The matter of A's seeded proceeding (a second matter of A, besides the seeded one). */
async function aProceedingMatter(f: Fixture): Promise<string> {
  const proceedingId = f.a.rows.proceeding?.proceedingId ?? '';
  const [row] = await inWorkspace(f.tx, f.a.id, (s) =>
    s
      .select({ matterId: schema.proceeding.matterId })
      .from(schema.proceeding)
      .where(eq(schema.proceeding.id, proceedingId)),
  );
  return row?.matterId ?? '';
}

function graphDeps(db: Database | Transaction) {
  const events: core.GraphEvent[] = [];
  return { deps: { db, events: { emit: (e: core.GraphEvent) => events.push(e) } }, events };
}

/** `call` as ub claiming A (no scope and from B's scope) and as ub in B with A's ids. */
async function expectGraphDenied(
  f: Fixture,
  call: (db: Database | Transaction, workspaceId: string) => Promise<unknown>,
): Promise<void> {
  const before = await graphOf(f, f.a.id);
  await expectDenied(call(f.tx, f.a.id));
  await expectDenied(f.asB((s) => call(s, f.a.id)));
  await expectDenied(call(f.tx, f.b.id));
  expect(await graphOf(f, f.a.id)).toEqual(before);
}

/** A call naming one id of each workspace, as ub in B: CrossWorkspaceError, B unchanged. */
async function expectCrossWorkspace(f: Fixture, call: () => Promise<unknown>): Promise<void> {
  const before = await graphOf(f, f.b.id);
  await expect(call()).rejects.toBeInstanceOf(core.CrossWorkspaceError);
  expect(await graphOf(f, f.b.id)).toEqual(before);
}

const CASES: Record<string, Case> = {
  previewMergeMatters: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aMatter = f.a.rows.matter?.matterId ?? '';
    const aOther = await aProceedingMatter(f);
    const bMatter = f.b.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.previewMergeMatters(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { intoMatterId: aMatter, fromMatterId: aOther },
      ),
    );
    const asB = { userId: f.ub, workspaceId: f.b.id };
    await expectCrossWorkspace(f, () =>
      core.previewMergeMatters(deps, asB, { intoMatterId: bMatter, fromMatterId: aMatter }),
    );
    await expectCrossWorkspace(f, () =>
      core.previewMergeMatters(deps, asB, { intoMatterId: aMatter, fromMatterId: bMatter }),
    );
    expect(events).toEqual([]);
    // A's owner previews it: the probe is sound.
    const preview = await core.previewMergeMatters(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { intoMatterId: aMatter, fromMatterId: aOther },
    );
    expect(preview.proceedings.map((p) => p.id)).toContain(f.a.rows.proceeding?.proceedingId);
  },
  previewSplitMatter: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aOther = await aProceedingMatter(f);
    const aProceeding = f.a.rows.proceeding?.proceedingId ?? '';
    const bMatter = f.b.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.previewSplitMatter(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { matterId: aOther, proceedingIds: [aProceeding] },
      ),
    );
    await expectCrossWorkspace(f, () =>
      core.previewSplitMatter(
        deps,
        { userId: f.ub, workspaceId: f.b.id },
        { matterId: bMatter, proceedingIds: [aProceeding] },
      ),
    );
    expect(events).toEqual([]);
    const preview = await core.previewSplitMatter(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { matterId: aOther, proceedingIds: [aProceeding] },
    );
    expect(preview.proceedings.map((p) => p.id)).toEqual([aProceeding]);
  },
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant merge and split previews: ub on workspace B against A (#392)', () => {
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
      await run({ ...seeded, tx, asB: (fn) => inWorkspace(tx, seeded.b.id, fn, seeded.ub) });
    });
  });
});
