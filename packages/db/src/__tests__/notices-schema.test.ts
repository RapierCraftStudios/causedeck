// The notices feed tables (#584): `notice` is global (no RLS; the app role cannot DELETE),
// `notice_match` is a tenant table under FORCE RLS whose matter and forum references cannot cross
// workspaces, and the CHECKs and unique keys that keep polling idempotent.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { GLOBAL_TABLES } from '../conventions.ts';
import { registeredTenantTables } from '../rls-policies.ts';
import { forum } from '../schema/court.ts';
import { matter } from '../schema/matter-graph.ts';
import { notice, noticeHoliday, noticeMatch } from '../schema/notices.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

const base = {
  sourceId: 'in.sc.notices',
  kind: 'circular',
  title: 'Circular',
  issuedOn: '2026-11-01',
  sourceType: 'system',
  sourceRef: 'test',
} as const;
const url = () => `https://notices.example.test/${randomUUID()}`;

describe('notice and notice_match', () => {
  it('keeps notice global and notice_match a tenant table under FORCE RLS', async () => {
    expect(GLOBAL_TABLES).toContain('notice');
    expect(registeredTenantTables()).toContain('notice_match');
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ name: string; forced: boolean; policies: string[] }>(sql`
        select c.relname::text as name, c.relforcerowsecurity as forced,
               array(select polname::text from pg_policy where polrelid = c.oid order by 1) as policies
          from pg_class c where c.relname in ('notice', 'notice_match') order by 1`);
      expect(rows).toEqual([
        { name: 'notice', forced: false, policies: [] },
        { name: 'notice_match', forced: true, policies: ['ws_isolation'] },
      ]);
      const [priv] = await tx.execute<{ write: boolean; del: boolean; clerk: boolean }>(sql`
        select has_table_privilege('causedeck_app', 'notice', 'select, insert, update') as write,
               has_table_privilege('causedeck_app', 'notice', 'delete') as del,
               has_table_privilege('causedeck_clerk', 'notice', 'select') as clerk`);
      expect(priv).toEqual({ write: true, del: false, clerk: false });
    });
  });

  it('rejects a duplicate (source, url), a bad document and a missing provenance source', async () => {
    await withTestDb(async (tx) => {
      const u = url();
      await tx.insert(notice).values({ ...base, url: u });
      const state = (values: Partial<typeof notice.$inferInsert>) =>
        sqlState(
          tx.transaction((sp) => sp.insert(notice).values({ ...base, url: url(), ...values })),
        );
      expect(
        await sqlState(tx.transaction((sp) => sp.insert(notice).values({ ...base, url: u }))),
      ).toBe('23505');
      expect(await state({ documentKey: 'k' })).toBe('23514');
      expect(
        await state({
          documentKey: 'k',
          documentSha256: 'nothex',
          documentMime: 'application/pdf',
        }),
      ).toBe('23514');
      expect(await state({ sourceRef: null })).toBe('23514');
      expect(await state({ title: '  ' })).toBe('23514');
      expect(await state({ sourceId: 'no.such.source' })).toBe('23503');
      await tx.insert(notice).values({
        ...base,
        url: url(),
        documentKey: 'k',
        documentSha256: 'a'.repeat(64),
        documentMime: 'application/pdf',
      });
    });
  });

  it('seeds the notice sources uncleared', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx.execute(sql`
        select id from source where kind = 'notice' and id = 'in.sc.notices'
          and cleared_at is null and terms_status = 'pending' and counsel_status = 'pending'`);
      expect(rows.length).toBe(1);
    });
  });

  it('needs a matter or a forum, and keeps both inside the workspace', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const [n] = await tx
        .insert(notice)
        .values({ ...base, url: url() })
        .returning();
      const noticeId = n?.id ?? '';
      const [matterB] = await inWorkspace(tx, b.id, (s) =>
        s
          .insert(matter)
          .values({ workspaceId: b.id, title: 'B', practiceArea: 'civil' })
          .returning(),
      );
      const [forumB] = await inWorkspace(tx, b.id, (s) =>
        s
          .insert(forum)
          .values({
            workspaceId: b.id,
            code: `xt.${randomUUID().slice(0, 8)}`,
            court: 'B Court',
            jurisdictionKind: 'district',
          })
          .returning(),
      );
      const [matterA] = await inWorkspace(tx, a.id, (s) =>
        s
          .insert(matter)
          .values({ workspaceId: a.id, title: 'A', practiceArea: 'civil' })
          .returning(),
      );
      await inWorkspace(tx, a.id, async (s) => {
        const attempt = (values: Partial<typeof noticeMatch.$inferInsert>) =>
          sqlState(
            s.transaction((sp) =>
              sp
                .insert(noticeMatch)
                .values({ workspaceId: a.id, noticeId, reason: 'forum', ...values }),
            ),
          );
        expect(await attempt({})).toBe('23514');
        expect(await attempt({ matterId: matterB?.id ?? '' })).toBe('23503');
        expect(await attempt({ forumId: forumB?.id ?? '' })).toBe('23503');
        expect(await attempt({ matterId: matterA?.id ?? '', reason: 'bogus' as never })).toBe(
          '23514',
        );
        await s.insert(noticeMatch).values({
          workspaceId: a.id,
          noticeId,
          matterId: matterA?.id ?? '',
          reason: 'matter_forum',
        });
        expect(await attempt({ matterId: matterA?.id ?? '', reason: 'matter_forum' })).toBe(
          '23505',
        );
      });
    });
  });
});

describe('notice_holiday', () => {
  it('is global, app-writable (select, insert) and keyed once per notice and date', async () => {
    expect(GLOBAL_TABLES).toContain('notice_holiday');
    await withTestDb(async (tx) => {
      const [priv] = await tx.execute<{ write: boolean; change: boolean; clerk: boolean }>(sql`
        select has_table_privilege('causedeck_app', 'notice_holiday', 'select, insert') as write,
               has_table_privilege('causedeck_app', 'notice_holiday', 'update') or
                 has_table_privilege('causedeck_app', 'notice_holiday', 'delete') as change,
               has_table_privilege('causedeck_clerk', 'notice_holiday', 'select') as clerk`);
      expect(priv).toEqual({ write: true, change: false, clerk: false });
      const [row] = await tx
        .insert(notice)
        .values({ ...base, kind: 'holiday', url: url() })
        .returning({ id: notice.id });
      const noticeId = row?.id ?? '';
      const add = (holidayOn: string, name: string) =>
        sqlState(
          tx.transaction((sp) => sp.insert(noticeHoliday).values({ noticeId, holidayOn, name })),
        );
      expect(await add('2026-12-25', 'Christmas')).toBeUndefined();
      expect(await add('2026-12-25', 'Again')).toBe('23505');
      expect(await add('2026-12-26', '  ')).toBe('23514');
    });
  });
});
