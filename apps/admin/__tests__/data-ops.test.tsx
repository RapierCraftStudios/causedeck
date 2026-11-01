// The Data Ops console (#514): every registered source shows freshness, error rate, parse yield and
// cost for 24 hours and 7 days, a support role is refused, and nothing but counts, ids, status, tier,
// cost and time reaches the pages (no URL hash, advocate id, forum or tenant data).
import { randomUUID } from 'node:crypto';

import type { Transaction } from '@causedeck/db';
import { closeTestDb, inWorkspace, schema, withTestDb, withUser } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq, sql } from 'drizzle-orm';
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
const { asSourceStaff, policyFor, setSourceKillSwitch, SourceNotCleared } =
  await import('@causedeck/core/sources');
const { default: DataOpsPage } = await import('../app/(console)/data-ops/page.tsx');
const { default: DataOpsSourcePage } = await import('../app/(console)/data-ops/[id]/page.tsx');

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
  // adapter_parse_run references a real document (FK since 0044): use each tenant's seeded one.
  const docOf = (ws: string): string =>
    (ws === t.a.id ? t.a.rows.document?.documentId : t.b.rows.document?.documentId) ?? '';
  for (const ws of [t.a.id, t.b.id]) {
    await inWorkspace(tx, ws, (s) =>
      s.execute(
        sql`insert into adapter_parse_run (workspace_id, document_id, adapter_id, adapter_version, forum_code, rows_parsed, rows_anchored, unmapped_headings, unknown_case_types, status)
            values (${ws}::uuid, ${docOf(ws)}::uuid, ${active}, '1', ${FORUM}, 10, 9, 0, 0, 'ok')`,
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
      // Captcha cost per court per day (#1078): the seeded captcha-tier row costs $0.25.
      expect(page).toContain('Captcha solving cost per court per day');
      expect(page).toContain('<td>$0.2500</td>');
      const rows = await dataOpsOverview(state.staff as never, active);
      expect(rows[0]?.week.fetches).toBe(3);
      expect(rows[0]?.day.costDollars).toBeCloseTo(0.5);
    });
  });

  it('shows bulk import progress: rows added, duplicates skipped, failures and storage used (#890)', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      await tx.insert(schema.corpusImportCursor).values({
        sourceId: 'aws-open-data-hc',
        dataset: 'hc',
        court: '33_10',
        year: 2021,
        archiveKey: 'data/tar/year=2021/court=33_10/pdfs.tar',
        position: 7,
        status: 'running',
        rowsAdded: 5,
        duplicatesSkipped: 2,
        failures: 1,
        bytesStored: 3 * 1024 * 1024,
      });
      const page = await html(DataOpsPage());
      for (const label of [
        'Bulk judgment import',
        'Rows added',
        'Duplicates skipped',
        'Storage used',
      ]) {
        expect(page).toContain(label);
      }
      expect(page).toContain('33_10');
      expect(page).toContain('3.0 MB');
      expect(page).not.toContain('pdfs.tar');
    });
  });
  it('shows the OCR queue depth and parked failures (#1030)', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const [j] = await tx
        .insert(schema.judgment)
        .values({
          sourceId: 'aws-open-data-sc',
          court: 'Supreme Court of India',
          caseNumbers: [],
          bench: [],
          sha256: 'a'.repeat(64),
          provenance: {
            url: 'https://example.test/x',
            fetchedAt: '2026-10-01T00:00:00Z',
            sha256: 'a'.repeat(64),
            sourceId: 'aws-open-data-sc',
            sourceVersion: '1',
            tierUsed: 'http',
            costDollars: 0,
          },
          pageText: [],
        })
        .returning({ id: schema.judgment.id });
      const judgmentId = (j as { id: string }).id;
      await tx.insert(schema.corpusOcrQueue).values([
        { judgmentId, pageNo: 1 },
        { judgmentId, pageNo: 2, attempts: 5, lastError: 'PROVIDER_DOWN', parkedAt: new Date() },
      ]);
      const page = await html(DataOpsPage());
      expect(page).toContain('OCR queue');
      expect(page).toContain('Queue depth: 1');
      expect(page).toContain('Parked failures: 1');
      expect(page).toContain('PROVIDER_DOWN');
    });
  });
  it('drills down to recent fetch logs without content', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const { active } = await seed(tx);
      const page = await html(DataOpsSourcePage({ params: Promise.resolve({ id: active }) }));
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
        await html(DataOpsSourcePage({ params: Promise.resolve({ id: t.active }) })),
      ].join('\n');
      for (const secret of [URL_HASH, ADVOCATE, FORUM, 'example.test']) {
        expect(pages).not.toContain(secret);
      }
      expect(pages).not.toMatch(/\b(documents?|parties|party|drafts?|memory)\b/i);
    });
  });

  it('a kill switch flip blocks the next policyFor call and writes source.changed', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const { active } = await seed(tx);
      const db = tx as never;
      await expect(policyFor(active, { db })).resolves.toMatchObject({ sourceId: active });
      await setSourceKillSwitch(db, asSourceStaff(staffFixture.userId), active, true);
      await expect(policyFor(active, { db })).rejects.toBeInstanceOf(SourceNotCleared);
      const events = await withUser(tx, { userId: staffFixture.userId }, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'source.changed')),
      );
      expect(events.length).toBeGreaterThan(0);
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
