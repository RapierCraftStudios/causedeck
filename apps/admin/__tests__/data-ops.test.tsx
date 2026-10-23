// The Data Ops console (#514): every registered source shows freshness, error rate, parse yield and
// cost for 24 hours and 7 days, a support role is refused, and nothing but counts, ids, status, tier,
// cost and time reaches the pages (no URL hash, advocate id, forum or tenant data).
import { randomUUID } from 'node:crypto';

import type { Transaction } from '@causedeck/db';
import { closeTestDb, inWorkspace, schema, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { sql } from 'drizzle-orm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { committedStaff, type StaffFixture } from './staff-fixture.ts';

const state = vi.hoisted((): { tx: unknown; staff: unknown } => ({
  tx: undefined,
  staff: undefined,
}));

vi.mock('@causedeck/core/runtime', () => ({
  db: new Proxy(
    {},
    {
      get: (_target, prop) => {
        const tx = state.tx as Record<string | symbol, unknown> | undefined;
        if (tx === undefined) throw new Error('no test transaction');
        const value = Reflect.get(tx, prop, tx);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(tx)
          : value;
      },
      getPrototypeOf: () => Object.getPrototypeOf(state.tx) as object | null,
    },
  ),
}));
vi.mock('../lib/staff.ts', () => ({ requireStaff: () => Promise.resolve(state.staff) }));

const { dataOpsOverview, StaffQueryDeniedError } = await import('../lib/data/index.ts');
const { default: DataOpsPage } = await import('../app/(console)/data-ops/page.tsx');
const { default: DataOpsSourcePage } =
  await import('../app/(console)/data-ops/[sourceId]/page.tsx');

const URL_HASH = 'f'.repeat(64);
const ADVOCATE = 'advocate-0b6c1a52';
const FORUM = 'forum-secret-code';

let staffFixture: StaffFixture;

beforeAll(async () => {
  staffFixture = await committedStaff('ops');
  state.staff = { userId: staffFixture.userId, email: staffFixture.email, role: 'ops' };
});

afterAll(async () => {
  await staffFixture.cleanup();
  await closeTestDb();
});

async function html(element: Promise<ReactElement>): Promise<string> {
  return renderToStaticMarkup(await element);
}

async function seed(tx: Transaction) {
  const t = await seedTwoTenants(tx);
  const active = `dataops.${randomUUID().slice(0, 8)}`;
  const idle = `dataops.${randomUUID().slice(0, 8)}`;
  for (const id of [active, idle]) {
    await tx.insert(schema.source).values({
      id,
      kind: 'court',
      baseUrl: 'https://example.test',
      owner: 'Example',
      termsStatus: 'cleared',
      counselStatus: 'cleared',
      clearedAt: new Date(),
    });
  }
  const now = Date.now();
  for (const [h, status, tier] of [
    [1, 200, 'http'],
    [2, 500, 'captcha'],
    [50, 200, 'proxy'],
  ] as const) {
    await tx.insert(schema.fetchLog).values({
      sourceId: active,
      urlHash: URL_HASH,
      status,
      tier,
      costDollars: '0.25',
      fetchedAt: new Date(now - h * 3_600_000),
      delegatedAdvocateId: ADVOCATE,
    });
  }
  for (const ws of [t.a.id, t.b.id]) {
    await inWorkspace(tx, ws, (s) =>
      s.execute(
        sql`insert into adapter_parse_run (workspace_id, document_id, adapter_id, adapter_version, forum_code, rows_parsed, rows_anchored, unmapped_headings, unknown_case_types, status)
            values (${ws}::uuid, gen_random_uuid(), ${active}, '1', ${FORUM}, 10, 9, 0, 0, 'ok')`,
      ),
    );
  }
  return { active, idle };
}

describe('Data Ops console', () => {
  it('shows freshness, error rate, yield and cost for 24h and 7d for every registered source', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const { active, idle } = await seed(tx);
      const page = await html(DataOpsPage());
      for (const label of [
        'Freshness (SLA)',
        'Error rate 24h / 7d',
        'Parse yield 24h / 7d',
        'Cost 24h / 7d',
        'Captcha solve rate 7d',
        'Tier mix 7d',
      ]) {
        expect(page).toContain(label);
      }
      expect(page).toContain(active);
      expect(page).toContain(idle);
      expect(page).toContain('50.0% / 33.3%');
      expect(page).toContain('90.0% / 90.0%');
      expect(page).toContain('Top failing sources');
      const rows = await dataOpsOverview(state.staff as never, active);
      expect(rows[0]?.week.fetches).toBe(3);
      expect(rows[0]?.day.costDollars).toBeCloseTo(0.5);
    });
  });

  it('drills down to recent fetch logs without content', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const { active } = await seed(tx);
      const page = await html(DataOpsSourcePage({ params: Promise.resolve({ sourceId: active }) }));
      expect(page).toContain('<td>500</td>');
      expect(page).toContain('captcha');
    });
  });

  it('renders no URL hash, advocate, forum or tenant data', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const t = await seed(tx);
      const pages = [
        await html(DataOpsPage()),
        await html(DataOpsSourcePage({ params: Promise.resolve({ sourceId: t.active }) })),
      ].join('\n');
      for (const secret of [URL_HASH, ADVOCATE, FORUM, 'example.test']) {
        expect(pages).not.toContain(secret);
      }
      expect(pages).not.toMatch(/\b(documents?|parties|party|drafts?|memory)\b/i);
    });
  });

  it('refuses a support role', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      await expect(
        dataOpsOverview({ userId: staffFixture.userId, role: 'support' }),
      ).rejects.toBeInstanceOf(StaffQueryDeniedError);
    });
  });
});
