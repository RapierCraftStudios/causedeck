// Drafting data layer (#766, part 1 of #75): `template` is global-or-workspace (system rows are
// readable by every member and writable only by the owner), `draft` is guarded against another
// workspace's template, and `draft_version` is immutable once inserted (content_sha256 is a
// 64-hex digest). Runs as the app role in rolled-back transactions on top of a committed system
// template.
import { createHash, randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { createOwnerDb } from '../owner.ts';
import { draft, draftVersion, template } from '../schema/drafting.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../testing/index.ts';
import { seedTwoTenants } from '../testing/two-tenants.ts';
import { sqlState } from './rls/fixtures.ts';

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
const system = { id: '', code: `test.system.${randomUUID().slice(0, 8)}` };

beforeAll(async () => {
  const [row] = await owner
    .insert(template)
    .values({ code: system.code, name: 'System', kind: 'notice', courtPreset: 'generic' })
    .returning({ id: template.id });
  if (row === undefined) throw new Error('system template insert failed');
  system.id = row.id;
});

afterAll(async () => {
  await owner.delete(template).where(eq(template.id, system.id));
  await owner.$client.end();
});

const sha = (seed: string) => createHash('sha256').update(seed).digest('hex');

const addVersion = (tx: Transaction, workspaceId: string, draftId: string, contentSha256: string) =>
  tx.transaction((sp) =>
    sp
      .insert(draftVersion)
      .values({ workspaceId, draftId, versionNo: 2, content: [], contentSha256 })
      .returning({ id: draftVersion.id }),
  );

describe('template (global-or-workspace)', () => {
  it('members of every workspace read the system template but cannot write it', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seedTwoTenants(tx);
      for (const [ws, uid] of [
        [a.id, ua],
        [b.id, ub],
      ] as const) {
        await inWorkspace(
          tx,
          ws,
          async (scoped) => {
            const rows = await scoped
              .select({ id: template.id })
              .from(template)
              .where(eq(template.id, system.id));
            expect(rows).toHaveLength(1);
            expect(
              await sqlState(
                scoped.transaction((sp) =>
                  sp.insert(template).values({
                    workspaceId: null,
                    code: `x.${randomUUID()}`,
                    name: 'Hijack',
                    kind: 'notice',
                    courtPreset: 'generic',
                  }),
                ),
              ),
            ).toBe('42501');
            const updated = await scoped
              .update(template)
              .set({ name: 'Hijacked' })
              .where(eq(template.id, system.id))
              .returning({ id: template.id });
            const deleted = await scoped
              .delete(template)
              .where(eq(template.id, system.id))
              .returning({ id: template.id });
            expect([updated, deleted]).toEqual([[], []]);
          },
          uid,
        );
      }
      const [row] = await owner
        .select({ name: template.name })
        .from(template)
        .where(eq(template.id, system.id));
      expect(row?.name).toBe('System');
    });
  });

  it('a draft may use a system or its own template, never another workspace’s', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua } = await seedTwoTenants(tx);
      const bTemplate = b.rows.template?.templateId as string;
      await inWorkspace(
        tx,
        a.id,
        async (scoped) => {
          const ok = await scoped
            .insert(draft)
            .values({ workspaceId: a.id, templateId: system.id, title: 'From system' })
            .returning({ id: draft.id });
          expect(ok).toHaveLength(1);
          expect(
            await sqlState(
              scoped.transaction((sp) =>
                sp.insert(draft).values({ workspaceId: a.id, templateId: bTemplate, title: 'x' }),
              ),
            ),
          ).toBeDefined();
        },
        ua,
      );
    });
  });
});

describe('draft_version (immutable)', () => {
  it('rejects an update or delete of a version and a malformed content_sha256', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const { draftId, id } = a.rows.draft_version as { draftId: string; id: string };
      await inWorkspace(
        tx,
        a.id,
        async (scoped) => {
          expect(
            await sqlState(
              scoped.transaction((sp) =>
                sp
                  .update(draftVersion)
                  .set({ content: [{ type: 'text' }] })
                  .where(eq(draftVersion.id, id)),
              ),
            ),
          ).toBe('42501');
          expect(
            await sqlState(
              scoped.transaction((sp) => sp.delete(draftVersion).where(eq(draftVersion.id, id))),
            ),
          ).toBe('42501');
          expect(await sqlState(addVersion(scoped, a.id, draftId, 'not-a-digest'))).toBe('23514');
          expect(await sqlState(addVersion(scoped, a.id, draftId, sha('v2')))).toBeUndefined();
        },
        ua,
      );
    });
  });

  it('deleting the draft cascades to its versions', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const { draftId } = a.rows.draft_version as { draftId: string; id: string };
      await inWorkspace(
        tx,
        a.id,
        async (scoped) => {
          await scoped.delete(draft).where(eq(draft.id, draftId));
          const left = await scoped
            .select({ id: draftVersion.id })
            .from(draftVersion)
            .where(eq(draftVersion.draftId, draftId));
          expect(left).toEqual([]);
        },
        ua,
      );
    });
  });

  it('workspace_id is NOT NULL on draft and draft_version but nullable on template', async () => {
    const rows = await owner.execute<{ table_name: string; is_nullable: string }>(sql`
      select table_name::text, is_nullable::text from information_schema.columns
      where table_schema = 'public' and column_name = 'workspace_id'
        and table_name in ('draft', 'draft_version', 'template') order by 1`);
    expect(rows).toEqual([
      { table_name: 'draft', is_nullable: 'NO' },
      { table_name: 'draft_version', is_nullable: 'NO' },
      { table_name: 'template', is_nullable: 'YES' },
    ]);
  });
});
