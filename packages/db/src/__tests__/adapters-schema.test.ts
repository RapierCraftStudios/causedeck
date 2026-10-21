// Court-adapter versioning and parse health (#372, migration 0044): the global `adapter_version`
// (one `active` row per adapter, checked semver and checksums, app-role DML, no clerk access), the
// tenant `adapter_parse_run` (metrics columns only) and the tenant-free `adapter_health_summary`
// view, which counts every workspace's runs by adapter and version without naming a workspace.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { createOwnerDb } from '../owner.ts';
import { adapterHealthSummary, adapterParseRun, adapterVersion } from '../schema/adapters.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../testing/index.ts';
import { TENANT_SEEDERS } from '../testing/two-tenants.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.$client.end();
});

const CHECKSUM = 'a'.repeat(64);
const adapterSlug = () => `xt-${randomUUID().slice(0, 8)}`;

/** Run `fn` in a savepoint, so a failing statement does not abort the test transaction. */
const attempt = (tx: Transaction, fn: (sp: Transaction) => Promise<unknown>) =>
  sqlState(tx.transaction(fn));

const insertVersion = (
  tx: Transaction,
  values: Partial<typeof adapterVersion.$inferInsert> & { adapterId: string },
) =>
  tx.insert(adapterVersion).values({
    version: '1.0.0',
    config: {},
    checksum: CHECKSUM,
    ...values,
  });

describe('adapter_version (#372)', () => {
  it('allows exactly one active row per adapter', async () => {
    await withTestDb(async (tx) => {
      const [first, second] = [adapterSlug(), adapterSlug()];
      const activatedAt = new Date();
      await insertVersion(tx, { adapterId: first, status: 'active', activatedAt });
      await insertVersion(tx, { adapterId: first, version: '1.0.1', status: 'draft' });
      await insertVersion(tx, { adapterId: second, status: 'active', activatedAt });
      expect(
        await attempt(tx, (sp) =>
          insertVersion(sp, { adapterId: first, version: '1.1.0', status: 'active', activatedAt }),
        ),
      ).toBe('23505');
      // Retiring the active row frees the slot.
      await tx
        .update(adapterVersion)
        .set({ status: 'retired' })
        .where(eq(adapterVersion.adapterId, first));
      await insertVersion(tx, {
        adapterId: first,
        version: '1.1.0',
        status: 'active',
        activatedAt,
      });
    });
  });

  it('checks the semver, the checksum, the digest and activated_at', async () => {
    await withTestDb(async (tx) => {
      const adapterId = adapterSlug();
      expect(await attempt(tx, (sp) => insertVersion(sp, { adapterId, version: '1.0' }))).toBe(
        '23514',
      );
      expect(await attempt(tx, (sp) => insertVersion(sp, { adapterId, checksum: 'abc' }))).toBe(
        '23514',
      );
      expect(
        await attempt(tx, (sp) => insertVersion(sp, { adapterId, fixturesDigest: 'XYZ' })),
      ).toBe('23514');
      expect(await attempt(tx, (sp) => insertVersion(sp, { adapterId, status: 'active' }))).toBe(
        '23514',
      );
      expect(await attempt(tx, (sp) => insertVersion(sp, { adapterId: 'Bad Id' }))).toBe('23514');
    });
  });

  it('accepts dotted adapter ids such as the catalogue uses (#395, migration 0045)', async () => {
    await withTestDb(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      await insertVersion(tx, { adapterId: `in.tn.madras-hc.principal-${suffix}` });
      await insertVersion(tx, { adapterId: `${adapterSlug()}.a.b-c` });
      for (const adapterId of ['Bad.Id', 'a..b', 'a.', '.a', 'a.1b']) {
        expect(await attempt(tx, (sp) => insertVersion(sp, { adapterId })), adapterId).toBe(
          '23514',
        );
      }
    });
  });

  it('is global, read and written by the app role only', async () => {
    const [row] = await owner.execute<{
      rls: boolean;
      app: boolean;
      appDelete: boolean;
      clerk: boolean;
    }>(sql`
      select c.relrowsecurity as rls,
             has_table_privilege('causedeck_app', c.oid, 'select, insert, update') as app,
             has_table_privilege('causedeck_app', c.oid, 'delete') as "appDelete",
             has_table_privilege('causedeck_clerk', c.oid, 'select, insert, update, delete') as clerk
      from pg_class c where c.relname = 'adapter_version'`);
    expect(row).toEqual({ rls: false, app: true, appDelete: false, clerk: false });
  });
});

describe('adapter_parse_run and adapter_health_summary (#372)', () => {
  it('stores metrics only: no column can hold row text', async () => {
    const columns = await owner.execute<{ name: string }>(sql`
      select column_name::text as name from information_schema.columns
      where table_name = 'adapter_parse_run' order by column_name`);
    expect(columns.map((c) => c.name)).toEqual([
      'adapter_id',
      'adapter_version',
      'created_at',
      'document_id',
      'forum_code',
      'halls_seen',
      'halls_unreadable',
      'id',
      'rows_anchored',
      'rows_parsed',
      'status',
      'unknown_case_types',
      'unmapped_headings',
      'workspace_id',
    ]);
  });

  it('summarises every workspace by adapter and version without tenant identifiers', async () => {
    const columns = await owner.execute<{ name: string }>(sql`
      select column_name::text as name from information_schema.columns
      where table_name = 'adapter_health_summary' order by ordinal_position`);
    expect(columns.map((c) => c.name)).toEqual([
      'adapter_id',
      'adapter_version',
      'runs',
      'ok_runs',
      'degraded_runs',
      'failed_runs',
      'rows_parsed',
      'rows_anchored',
    ]);

    await withTestDb(async (tx) => {
      const adapterId = adapterSlug();
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const seedRun = (
        workspaceId: string,
        version: string,
        status: 'ok' | 'degraded' | 'failed',
        rows: number,
      ) =>
        inWorkspace(tx, workspaceId, async (scoped) => {
          const seeded = await TENANT_SEEDERS.document?.(scoped, {
            workspaceId,
            ownerId: '',
            tag: randomUUID().slice(0, 8),
          });
          await scoped.insert(adapterParseRun).values({
            workspaceId,
            documentId: seeded?.documentId ?? '',
            adapterId,
            adapterVersion: version,
            forumCode: 'test.echo.principal',
            rowsParsed: rows + 1,
            rowsAnchored: rows,
            unmappedHeadings: 0,
            unknownCaseTypes: 0,
            status,
          });
        });
      await seedRun(a.id, '1.0.0', 'ok', 10);
      await seedRun(a.id, '1.0.0', 'degraded', 4);
      await seedRun(b.id, '1.0.0', 'failed', 0);
      await seedRun(b.id, '1.1.0', 'ok', 7);

      const expected = [
        {
          adapterId,
          adapterVersion: '1.0.0',
          runs: 3,
          okRuns: 1,
          degradedRuns: 1,
          failedRuns: 1,
          rowsParsed: 17,
          rowsAnchored: 14,
        },
        {
          adapterId,
          adapterVersion: '1.1.0',
          runs: 1,
          okRuns: 1,
          degradedRuns: 0,
          failedRuns: 0,
          rowsParsed: 8,
          rowsAnchored: 7,
        },
      ];
      const read = (q: Transaction) =>
        q
          .select()
          .from(adapterHealthSummary)
          .where(eq(adapterHealthSummary.adapterId, adapterId))
          .orderBy(adapterHealthSummary.adapterVersion);
      // The same counts unscoped and from either workspace: the view spans every workspace.
      expect(await read(tx)).toEqual(expected);
      expect(await inWorkspace(tx, a.id, read)).toEqual(expected);
      expect(await inWorkspace(tx, b.id, read)).toEqual(expected);
      // The base table itself stays under RLS: B sees only its own runs.
      const bRuns = await inWorkspace(tx, b.id, (scoped) =>
        scoped
          .select({ workspaceId: adapterParseRun.workspaceId })
          .from(adapterParseRun)
          .where(eq(adapterParseRun.adapterId, adapterId)),
      );
      expect(bRuns).toEqual([{ workspaceId: b.id }, { workspaceId: b.id }]);
    });
  });

  it('lets the app and clerk roles only read the view', async () => {
    const [row] = await owner.execute<{ app: boolean; appWrite: boolean; clerk: boolean }>(sql`
      select has_table_privilege('causedeck_app', 'adapter_health_summary', 'select') as app,
             has_table_privilege('causedeck_app', 'adapter_health_summary', 'insert, update, delete') as "appWrite",
             has_table_privilege('causedeck_clerk', 'adapter_health_summary', 'select') as clerk`);
    expect(row).toEqual({ app: true, appWrite: false, clerk: true });
  });
});
