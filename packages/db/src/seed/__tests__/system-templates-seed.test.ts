// System template seed (#76): idempotent upsert keyed by (code, null workspace) that rewrites a row only
// when its checksum changes, and RLS: read-only for the app role, copies owned by the workspace.
import { Secret } from '@causedeck/config/env';
import type { SystemTemplateSeed } from '@causedeck/validators/drafting';
import { eq, isNull, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../../client.ts';
import { createOwnerDb } from '../../owner.ts';
import { template } from '../../schema/drafting.ts';
import { sqlState } from '../../__tests__/rls/fixtures.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../../testing/index.ts';
import { seedTwoTenants } from '../../testing/two-tenants.ts';
import { seedSystemTemplates } from '../system-templates.ts';

const entry = (code: string, checksum: string, name = 'Memo'): SystemTemplateSeed => ({
  code,
  name,
  kind: 'memo',
  courtPreset: 'generic',
  blocks: [{ type: 'paragraph', text: 'Fixed text' }],
  locale: 'en',
  semver: '1.0.0',
  checksum: checksum.repeat(64).slice(0, 64),
  reviewedBy: null,
});

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.delete(template).where(eq(template.code, 'seed_test.copy'));
  await owner.$client.end();
});

async function ownerRolledBack(fn: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await owner.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

const rowsFor = (tx: Transaction, code: string) =>
  tx.select().from(template).where(eq(template.code, code));

describe('seedSystemTemplates', () => {
  it('is idempotent and rewrites a row only when its checksum changes', async () => {
    await ownerRolledBack(async (tx) => {
      const code = 'seed_test.memo';
      const first = await seedSystemTemplates(tx, [entry(code, 'a')]);
      expect(first).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
      const [row] = await rowsFor(tx, code);
      expect(row?.isSystem).toBe(true);
      expect(row?.workspaceId).toBeNull();

      const second = await seedSystemTemplates(tx, [entry(code, 'a')]);
      expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
      const again = await rowsFor(tx, code);
      expect(again).toHaveLength(1);
      expect(again[0]?.id).toBe(row?.id);
      expect(again[0]?.updatedAt).toEqual(row?.updatedAt);

      const third = await seedSystemTemplates(tx, [entry(code, 'b', 'Memo, revised')]);
      expect(third).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
      const [changed] = await rowsFor(tx, code);
      expect(changed).toMatchObject({
        id: row?.id,
        name: 'Memo, revised',
        checksum: 'b'.repeat(64),
      });
    });
  });

  it('is read-only for the app role, which can copy a template into its own workspace', async () => {
    const code = 'seed_test.copy';
    // Committed, as the deploy seed leaves it, so the app-role transaction below sees the row.
    await seedSystemTemplates(owner, [entry(code, 'c')]);
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      await inWorkspace(
        tx,
        a.id,
        async (scoped) => {
          const [system] = await scoped.select().from(template).where(eq(template.code, code));
          expect(system?.isSystem).toBe(true);
          expect(
            await sqlState(
              scoped.transaction((sp) =>
                sp.insert(template).values({
                  workspaceId: null,
                  code: 'seed_test.injected',
                  name: 'x',
                  kind: 'memo',
                  courtPreset: 'generic',
                }),
              ),
            ),
          ).toBe('42501');
          const updated = await scoped
            .update(template)
            .set({ name: 'Hijacked' })
            .where(eq(template.code, code))
            .returning({ id: template.id });
          expect(updated).toEqual([]);
          const [copy] = await scoped
            .insert(template)
            .values({
              workspaceId: a.id,
              code,
              name: 'My copy',
              kind: system?.kind ?? 'memo',
              courtPreset: system?.courtPreset ?? 'generic',
              blocks: system?.blocks ?? [],
            })
            .returning();
          expect(copy).toMatchObject({ workspaceId: a.id, isSystem: false });
          expect(copy?.id).not.toBe(system?.id);
          const systemRows = await scoped
            .select()
            .from(template)
            .where(isNull(template.workspaceId));
          expect(systemRows.find((r) => r.code === code)?.name).toBe('Memo');
        },
        ua,
      );
    });
  });
});
