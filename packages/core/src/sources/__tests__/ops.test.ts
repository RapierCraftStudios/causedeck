// The Data Ops read model (#514): 24 hour and 7 day windows, error and captcha solve rates, tier
// mix, freshness against the per-kind SLA, content-free log rows, and a kill switch that stops the
// very next `policyFor` and is audited.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withUser, type Database, type Transaction } from '@causedeck/db';
import { closeTestDb, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  asSourceStaff,
  FRESHNESS_SLA_HOURS,
  policyFor,
  setSourceKillSwitch,
  SourceNotCleared,
  sourceFetchLogs,
  sourceOpsOverview,
  topFailingSources,
} from '../index.ts';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let owner: Database;
let staffId: string;

beforeAll(async () => {
  owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
  staffId = randomUUID();
  await owner
    .insert(schema.user)
    .values({ id: staffId, name: 'ops', email: `ops-${staffId}@causedeck.test` });
  await owner.insert(schema.staffUser).values({ userId: staffId, role: 'ops' });
});

afterAll(async () => {
  await owner.delete(schema.user).where(eq(schema.user.id, staffId));
  await owner.$client.end();
  await closeTestDb();
});

async function seedSource(
  tx: Transaction,
  id: string,
  kind: schema.SourceKind = 'court',
  cleared = true,
) {
  await tx.insert(schema.source).values({
    id,
    kind,
    baseUrl: 'https://example.test',
    owner: 'Example',
    termsStatus: cleared ? 'cleared' : 'pending',
    counselStatus: cleared ? 'cleared' : 'pending',
    clearedAt: cleared ? NOW : null,
  });
}

type LogSeed = { h: number; status: number; tier: schema.SourceMaxTier | null; cost?: number };
async function seedLogs(tx: Transaction, sourceId: string, logs: LogSeed[]) {
  for (const l of logs) {
    await tx.insert(schema.fetchLog).values({
      sourceId,
      urlHash: 'a'.repeat(64),
      status: l.status,
      tier: l.tier,
      costDollars: String(l.cost ?? 0),
      fetchedAt: hoursAgo(l.h),
      delegatedAdvocateId: 'advocate-secret',
    });
  }
}

describe('sourceOpsOverview', () => {
  it('buckets 24 hour and 7 day windows, rates, tier mix and freshness per source', async () => {
    await withTestDb(async (tx) => {
      const id = `ops.${randomUUID().slice(0, 8)}`;
      await seedSource(tx, id);
      await seedLogs(tx, id, [
        { h: 1, status: 200, tier: 'http', cost: 0.01 },
        { h: 2, status: 500, tier: 'http', cost: 0.01 },
        { h: 3, status: 200, tier: 'captcha', cost: 0.1 },
        { h: 4, status: 0, tier: null },
        { h: 30, status: 200, tier: 'captcha', cost: 0.1 },
        { h: 40, status: 403, tier: 'captcha', cost: 0.1 },
        { h: 24 * 9, status: 200, tier: 'http', cost: 5 },
      ]);
      const [row] = await sourceOpsOverview(tx, NOW, undefined, id);
      expect(row?.day).toMatchObject({ fetches: 4, errors: 2, errorRate: 0.5, captchaCalls: 1 });
      expect(row?.day.captchaSolveRate).toBe(1);
      expect(row?.day.costDollars).toBeCloseTo(0.21);
      expect(row?.day.tierMix).toEqual({ http: 2, headless: 0, proxy: 0, captcha: 1 });
      expect(row?.week).toMatchObject({ fetches: 6, errors: 3, captchaCalls: 3 });
      expect(row?.week.captchaSolveRate).toBeCloseTo(2 / 3);
      expect(row?.week.costDollars).toBeCloseTo(0.31);
      expect(row?.lastSuccessAt).toEqual(hoursAgo(1));
      expect(row?.freshnessHours).toBeCloseTo(1);
      expect(row?.slaHours).toBe(FRESHNESS_SLA_HOURS.court);
      expect(row?.fresh).toBe(true);
      expect(row?.status).toBe('cleared');
      expect(row?.daily).toHaveLength(7);
      expect(row?.daily.at(-1)?.fetches).toBe(4);
    });
  });

  it('lists a source with no fetches, never fresh, with null rates', async () => {
    await withTestDb(async (tx) => {
      const id = `ops.${randomUUID().slice(0, 8)}`;
      await seedSource(tx, id, 'news', false);
      const [row] = await sourceOpsOverview(tx, NOW, undefined, id);
      expect(row).toMatchObject({ status: 'not_cleared', lastSuccessAt: null, fresh: false });
      expect(row?.week).toMatchObject({ fetches: 0, errorRate: null, captchaSolveRate: null });
      expect(row?.week.parseYield).toBeNull();
    });
  });

  it('marks a source stale past its SLA and joins parse yield by adapter id', async () => {
    await withTestDb(async (tx) => {
      const id = `ops.${randomUUID().slice(0, 8)}`;
      await seedSource(tx, id, 'news');
      await seedLogs(tx, id, [{ h: 7, status: 200, tier: 'http' }]);
      const yields = {
        day: [],
        week: [{ adapterId: id, runs: 2, rowsParsed: 10, rowsAnchored: 8 }],
      };
      const [row] = await sourceOpsOverview(tx, NOW, yields, id);
      expect(row?.fresh).toBe(false);
      expect(row?.day.parseYield).toBeNull();
      expect(row?.week.parseYield).toBe(0.8);
    });
  });

  it('ranks the top failing sources by 24 hour errors', async () => {
    await withTestDb(async (tx) => {
      const [a, b, c] = ['a', 'b', 'c'].map((k) => `ops.${k}.${randomUUID().slice(0, 8)}`);
      for (const id of [a, b, c]) await seedSource(tx, String(id));
      await seedLogs(tx, String(a), [{ h: 1, status: 500, tier: 'http' }]);
      await seedLogs(tx, String(b), [
        { h: 1, status: 500, tier: 'http' },
        { h: 2, status: 0, tier: null },
      ]);
      await seedLogs(tx, String(c), [{ h: 1, status: 200, tier: 'http' }]);
      const rows = await sourceOpsOverview(tx, NOW);
      const ours = rows.filter((r) => [a, b, c].includes(r.id));
      expect(topFailingSources(ours).map((r) => r.id)).toEqual([b, a]);
    });
  });
});

describe('sourceFetchLogs', () => {
  it('returns newest first with status, tier, cost and time only', async () => {
    await withTestDb(async (tx) => {
      const id = `ops.${randomUUID().slice(0, 8)}`;
      await seedSource(tx, id);
      await seedLogs(tx, id, [
        { h: 5, status: 200, tier: 'http', cost: 0.5 },
        { h: 1, status: 500, tier: 'proxy' },
      ]);
      const logs = await sourceFetchLogs(tx, id);
      expect(logs.map((l) => l.status)).toEqual([500, 200]);
      expect(Object.keys(logs[0] ?? {}).sort()).toEqual([
        'costDollars',
        'fetchedAt',
        'id',
        'status',
        'tier',
      ]);
      expect(JSON.stringify(logs)).not.toContain('advocate-secret');
      expect(JSON.stringify(logs)).not.toContain('aaaaaaaa');
    });
  });
});

describe('kill switch', () => {
  it('stops the next policyFor and records source.changed with old and new values', async () => {
    await withTestDb(async (tx) => {
      const id = `ops.${randomUUID().slice(0, 8)}`;
      await seedSource(tx, id);
      await expect(policyFor(id, { db: tx })).resolves.toMatchObject({ sourceId: id });
      await setSourceKillSwitch(tx, asSourceStaff(staffId), id, true);
      await expect(policyFor(id, { db: tx })).rejects.toBeInstanceOf(SourceNotCleared);
      // Account-level events are visible only to their actor (RLS `account_self`).
      const events = await withUser(tx, { userId: staffId }, (t) =>
        t
          .select()
          .from(schema.auditEvent)
          .where(
            and(eq(schema.auditEvent.action, 'source.changed'), eq(schema.auditEvent.targetId, id)),
          ),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toMatchObject({
        change: 'kill_switch',
        old_killSwitch: false,
        new_killSwitch: true,
      });
    });
  });
});
