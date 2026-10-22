// Synthetic matter sets (#386): deterministic, 500 matters / 1,500 proceedings at the defaults,
// fictional names only, no CNR, contact only on clients and professionals, an idempotent insert,
// and refused in production.
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Transaction } from '../../client.ts';
import { withWorkspace } from '../../rls.ts';
import { withTestDb } from '../../testing/index.ts';
import { seedTwoTenants } from '../../testing/two-tenants.ts';
import {
  insertSyntheticMatterSet,
  SYNTHETIC_FICTIONAL_SUFFIX,
  SYNTHETIC_MARKETS,
  syntheticMatterSet,
  SyntheticSeedInProductionError,
} from '../synthetic/index.ts';

const TODAY = '2026-10-21';
const WS = '00000000-0000-4000-8000-000000000386';
const FORUMS = ['00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000003f2'];

const both = (workspaceId: string, forumIds: readonly string[], matters?: number) =>
  SYNTHETIC_MARKETS.map((market) =>
    syntheticMatterSet({
      market,
      workspaceId,
      forumIds,
      today: TODAY,
      ...(matters === undefined ? {} : { matters }),
    }),
  );

async function counts(tx: Transaction, workspaceId: string): Promise<Record<string, number>> {
  return withWorkspace(tx, { workspaceId }, async (s) => {
    const out: Record<string, number> = {};
    for (const table of ['matter', 'person', 'role_edge', 'proceeding', 'listing', 'obligation']) {
      const rows = await s.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      out[table] = rows[0]?.n ?? 0;
    }
    return out;
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('synthetic matter sets', () => {
  it('make 500 matters and 1,500 proceedings at the defaults, the same rows every time', () => {
    const sets = both(WS, FORUMS);
    expect(sets.reduce((n, s) => n + s.matters.length, 0)).toBe(500);
    expect(sets.reduce((n, s) => n + s.proceedings.length, 0)).toBe(1500);
    expect(both(WS, FORUMS)).toEqual(sets);
    // Another workspace gets other ids.
    const [other] = both('00000000-0000-4000-8000-000000000999', FORUMS);
    expect(other?.matters[0]?.id).not.toBe(sets[0]?.matters[0]?.id);
    // The two markets never share a case number.
    const numbers = sets.flatMap((s) => s.proceedings.flatMap((p) => (p.number ? [p.number] : [])));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('write fictional people only, no CNR, and contact only for clients and professionals', () => {
    for (const set of both(WS, FORUMS)) {
      for (const p of set.persons) {
        expect(p.name.endsWith(SYNTHETIC_FICTIONAL_SUFFIX), p.name).toBe(true);
        if (p.contact != null) expect(['client', 'professional']).toContain(p.kind);
        if (p.contact?.email !== undefined) expect(p.contact.email).toMatch(/\.test$/);
      }
      for (const p of set.proceedings) {
        expect(p.cnr ?? null).toBeNull();
        expect(p.titlePetitioner?.endsWith(SYNTHETIC_FICTIONAL_SUFFIX)).toBe(true);
        if (p.number != null) expect(p.number).toMatch(/^SYN-\d{4}$/);
      }
      // Some matters without a next date, some with only a past one, some with a conflict.
      expect(set.listings.some((l) => l.canonical === false)).toBe(true);
      expect(set.listings.some((l) => l.canonical === true && l.listDate < TODAY)).toBe(true);
    }
  });

  it('insert into the workspace once; a second run writes nothing', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      const forumId = a.rows.forum?.forumId ?? '';
      const before = await counts(tx, a.id);
      const sets = both(a.id, [forumId], 20);
      for (const set of sets) await insertSyntheticMatterSet(tx, set);
      const after = await counts(tx, a.id);
      expect((after.matter ?? 0) - (before.matter ?? 0)).toBe(40);
      expect((after.proceeding ?? 0) - (before.proceeding ?? 0)).toBe(120);
      expect((after.role_edge ?? 0) - (before.role_edge ?? 0)).toBe(120);
      for (const set of sets) await insertSyntheticMatterSet(tx, set);
      expect(await counts(tx, a.id)).toEqual(after);
    });
  });

  it('never runs when NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const [set] = both(WS, FORUMS, 1);
    if (set === undefined) throw new Error('no set');
    await expect(insertSyntheticMatterSet({} as Transaction, set)).rejects.toBeInstanceOf(
      SyntheticSeedInProductionError,
    );
  });
});
