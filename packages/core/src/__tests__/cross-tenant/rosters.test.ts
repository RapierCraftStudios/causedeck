// Cross-tenant roster services (#387) and bench-change alerts (#389): user `ub`, working in
// workspace B, calls the roster services with workspace A's ids. Writes and the alert services must
// be NOT_FOUND, FORBIDDEN or VALIDATION (`denies`) and leave A's rosters, entries, benches, alerts
// and notifications unchanged; the day lookups and the list open `withWorkspace` on the given id,
// so from B's scope A's id is a TenancyError and B's own call never returns A's roster
// (`self-scoped`). Kept beside services.test.ts and driven by the same registry
// (`@causedeck/db/testing/cross-tenant-registry`), so a registered service without a case fails.
import { schema, TenancyError, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/rosters.test.ts';

interface Fixture extends TwoTenants {
  tx: Transaction;
  /** Run `fn` as `ub` inside workspace B's scope. */
  asB: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
  /** A's active roster on its two-tenant roster forum, confirmed by A's owner. */
  aRoster: core.RosterWithEntries;
  aForumId: string;
  aBenchId: string;
}

type Case = (f: Fixture) => Promise<void>;

const ON = '2026-12-01';

/** Rejects with a WorkspaceError whose code is NOT_FOUND, FORBIDDEN or VALIDATION. */
async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected NOT_FOUND, FORBIDDEN or VALIDATION').toBeInstanceOf(core.WorkspaceError);
  expect(['NOT_FOUND', 'FORBIDDEN', 'VALIDATION']).toContain((error as core.WorkspaceError).code);
}

/** A's roster rows and its own benches, for before/after checks. */
async function aRosterState(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, async (s) => ({
    rosters: await s.select().from(schema.benchRoster).orderBy(schema.benchRoster.id),
    entries: await s.select().from(schema.benchRosterEntry).orderBy(schema.benchRosterEntry.id),
    benches: await s
      .select()
      .from(schema.bench)
      .where(eq(schema.bench.workspaceId, f.a.id))
      .orderBy(schema.bench.id),
  }));
}

/** The workspace's bench on its two-tenant roster forum (seeded with the draft roster). */
async function rosterForumBench(tx: Transaction, workspaceId: string, forumId: string) {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ id: schema.bench.id })
      .from(schema.bench)
      .where(eq(schema.bench.forumId, forumId))
      .limit(1),
  );
  if (row === undefined) throw new Error('two-tenant roster bench missing');
  return row.id;
}

/** B's own forum and bench (the two-tenant roster seed). */
async function bForum(f: Fixture) {
  const forumId = f.b.rows.bench_roster?.forumId ?? '';
  return { forumId, benchId: await rosterForumBench(f.tx, f.b.id, forumId) };
}

/** A's bench-change alerts and notifications, for before/after checks (#389). */
async function aAlertState(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, async (s) => ({
    alerts: await s.select().from(schema.benchChangeAlert).orderBy(schema.benchChangeAlert.id),
    notifications: await s.select().from(schema.notification).orderBy(schema.notification.id),
  }));
}

/** Bench-change deps that record events and deliveries. */
function benchChangeDeps() {
  const events: core.CourtEvent[] = [];
  const jobs: unknown[] = [];
  return {
    events,
    jobs,
    deps: {
      events: { emit: (e: core.CourtEvent) => events.push(e) },
      enqueueDelivery: (job: unknown) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
  };
}

const CASES: Record<string, Case> = {
  confirmRosterImport: async (f) => {
    const before = await aRosterState(f);
    const input = {
      forumId: f.aForumId,
      effectiveFrom: '2027-01-06',
      entries: [{ hallNo: '12A', judges: ['Justice X. Probe (fictional)'] }],
    };
    // ub claiming A: no scope, and from B's scope.
    await expectDenied(
      core.confirmRosterImport(f.tx, { userId: f.ub, workspaceId: f.a.id }, input),
    );
    await expectDenied(
      f.asB((s) => core.confirmRosterImport(s, { userId: f.ub, workspaceId: f.a.id }, input)),
    );
    await expectDenied(
      f.asB((s) =>
        core.confirmRosterImport(s, { userId: f.ua, workspaceId: f.a.id, role: 'owner' }, input),
      ),
    );
    // ub in B with A's forum, A's bench, A's document: none of A's rows are visible.
    const own = { userId: f.ub, workspaceId: f.b.id };
    await expectDenied(core.confirmRosterImport(f.tx, own, input));
    const b = await bForum(f);
    await expectDenied(
      core.confirmRosterImport(f.tx, own, {
        forumId: b.forumId,
        effectiveFrom: '2027-01-06',
        entries: [{ hallNo: '12A', benchId: f.aBenchId }],
      }),
    );
    const aDocument = f.a.rows.document?.documentId;
    if (aDocument !== undefined) {
      await expectDenied(
        core.confirmRosterImport(f.tx, own, {
          forumId: b.forumId,
          effectiveFrom: '2027-01-06',
          sourceDocumentId: aDocument,
          entries: [{ hallNo: '12A', benchId: b.benchId }],
        }),
      );
    }
    expect(await aRosterState(f)).toEqual(before);
  },
  supersede: async (f) => {
    const before = await aRosterState(f);
    const input = { rosterId: f.aRoster.roster.id, effectiveFrom: '2027-01-06' };
    await expectDenied(core.supersede(f.tx, { userId: f.ub, workspaceId: f.a.id }, input));
    await expectDenied(
      f.asB((s) => core.supersede(s, { userId: f.ub, workspaceId: f.a.id }, input)),
    );
    await expectDenied(core.supersede(f.tx, { userId: f.ub, workspaceId: f.b.id }, input));
    expect(await aRosterState(f)).toEqual(before);
  },
  getRosterAt: async (f) => {
    const input = { forumId: f.aForumId, on: ON };
    await expect(f.asB((s) => core.getRosterAt(s, f.a.id, input))).rejects.toBeInstanceOf(
      TenancyError,
    );
    expect(await f.asB((s) => core.getRosterAt(s, f.b.id, input))).toBeNull();
    expect(await core.getRosterAt(f.tx, f.b.id, input)).toBeNull();
    // A's own call still sees it.
    expect((await core.getRosterAt(f.tx, f.a.id, input))?.roster.id).toBe(f.aRoster.roster.id);
  },
  resolveBenchForHall: async (f) => {
    const hallId = f.aRoster.entries[0]?.hallId ?? undefined;
    const input = { forumId: f.aForumId, on: ON, hallNo: '12A' };
    await expect(f.asB((s) => core.resolveBenchForHall(s, f.a.id, input))).rejects.toBeInstanceOf(
      TenancyError,
    );
    expect(await f.asB((s) => core.resolveBenchForHall(s, f.b.id, input))).toBeNull();
    if (hallId !== undefined) {
      expect(
        await core.resolveBenchForHall(f.tx, f.b.id, { forumId: f.aForumId, on: ON, hallId }),
      ).toBeNull();
    }
    expect((await core.resolveBenchForHall(f.tx, f.a.id, input))?.rosterId).toBe(
      f.aRoster.roster.id,
    );
  },
  listRosters: async (f) => {
    await expect(f.asB((s) => core.listRosters(s, f.a.id))).rejects.toBeInstanceOf(TenancyError);
    const own = await f.asB((s) => core.listRosters(s, f.b.id));
    expect(own.map((r) => r.id)).not.toContain(f.aRoster.roster.id);
    expect(own.filter((r) => r.workspaceId !== f.b.id)).toEqual([]);
    expect(await core.listRosters(f.tx, f.b.id, { forumId: f.aForumId })).toEqual([]);
  },
  // Bench-change alerts (#389).
  detectBenchChanges: async (f) => {
    const before = await aAlertState(f);
    const recorded = benchChangeDeps();
    const input = { rosterId: f.aRoster.roster.id };
    await expectDenied(
      core.detectBenchChanges(f.tx, { userId: f.ub, workspaceId: f.a.id }, input, recorded.deps),
    );
    await expectDenied(
      f.asB((s) =>
        core.detectBenchChanges(s, { userId: f.ub, workspaceId: f.a.id }, input, recorded.deps),
      ),
    );
    await expectDenied(
      core.detectBenchChanges(f.tx, { userId: f.ub, workspaceId: f.b.id }, input, recorded.deps),
    );
    expect(recorded.events).toEqual([]);
    expect(recorded.jobs).toEqual([]);
    expect(await aAlertState(f)).toEqual(before);
  },
  listAlerts: async (f) => {
    const aAlertId = f.a.rows.bench_change_alert?.alertId ?? '';
    expect(aAlertId).not.toBe('');
    await expectDenied(core.listAlerts(f.tx, { userId: f.ub, workspaceId: f.a.id }));
    await expectDenied(f.asB((s) => core.listAlerts(s, { userId: f.ub, workspaceId: f.a.id })));
    const own = await core.listAlerts(f.tx, { userId: f.ub, workspaceId: f.b.id });
    expect(own.map((a) => a.id)).not.toContain(aAlertId);
    expect(own.filter((a) => a.workspaceId !== f.b.id)).toEqual([]);
    // A's own owner still sees it.
    const mine = await core.listAlerts(f.tx, { userId: f.ua, workspaceId: f.a.id });
    expect(mine.map((a) => a.id)).toContain(aAlertId);
  },
  dismissAlert: async (f) => {
    const before = await aAlertState(f);
    const input = { alertId: f.a.rows.bench_change_alert?.alertId ?? '' };
    await expectDenied(core.dismissAlert(f.tx, { userId: f.ub, workspaceId: f.a.id }, input));
    await expectDenied(
      f.asB((s) => core.dismissAlert(s, { userId: f.ub, workspaceId: f.a.id }, input)),
    );
    await expectDenied(core.dismissAlert(f.tx, { userId: f.ub, workspaceId: f.b.id }, input));
    expect(await aAlertState(f)).toEqual(before);
  },
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant roster services: ub on workspace B against A (#387, #389)', () => {
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
      const aForumId = seeded.a.rows.bench_roster?.forumId;
      if (aForumId === undefined) throw new Error('two-tenant roster seed rows missing');
      const aBenchId = await rosterForumBench(tx, seeded.a.id, aForumId);
      const hall = await inWorkspace(tx, seeded.a.id, async (s) => {
        const [row] = await s
          .insert(schema.courtHall)
          .values({ workspaceId: seeded.a.id, forumId: aForumId, hallNo: '12A' })
          .returning({ id: schema.courtHall.id });
        return row?.id;
      });
      const aRoster = await core.confirmRosterImport(
        tx,
        { userId: seeded.ua, workspaceId: seeded.a.id },
        {
          forumId: aForumId,
          effectiveFrom: '2026-11-01',
          entries: [{ hallNo: '12A', benchId: aBenchId }],
        },
      );
      expect(aRoster.entries[0]?.hallId).toBe(hall);
      await run({
        ...seeded,
        tx,
        asB: (fn) => inWorkspace(tx, seeded.b.id, fn, seeded.ub),
        aRoster,
        aForumId,
        aBenchId,
      });
    });
  });
});
