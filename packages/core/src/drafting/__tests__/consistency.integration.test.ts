// Draft consistency against Postgres (#78): the report is idempotent per version, a new listing gives
// a new revision, `applyFix` is refused without `confirm: true` and creates version_no + 1 with it,
// annexures map from the matter's documents, and a stranger's workspace sees nothing.
import { createHash, randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  applyFix,
  createDraft,
  getConsistencyReport,
  listFindings,
  listVersions,
  runConsistencyCheck,
  saveVersion,
} from '../index.ts';

const content = (text: string) => [{ type: 'paragraph', id: 'p1', text }];
const TEXT = 'The order dated 05/11/2026 is annexed as Annexure P-1 and Annexure P-2.';

async function setup(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const seeded = await seedTwoTenants(tx);
  const workspaceId = seeded.a.id;
  const proceedingId = seeded.a.rows.order?.proceedingId ?? '';
  const [proc] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ matterId: schema.proceeding.matterId })
      .from(schema.proceeding)
      .where(eq(schema.proceeding.id, proceedingId)),
  );
  const matterId = proc?.matterId ?? '';
  const [tpl] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.template)
      .values({
        workspaceId,
        code: `it.${randomUUID().slice(0, 8)}`,
        name: 'Consistency template',
        kind: 'notice',
        courtPreset: 'madras_hc',
        blocks: content('Template body'),
      })
      .returning({ id: schema.template.id }),
  );
  const actor = { workspaceId, userId: seeded.ua };
  const created = await createDraft({ db: tx }, actor, {
    templateId: tpl?.id ?? '',
    matterId,
    title: 'Consistency draft',
  });
  const version = await saveVersion({ db: tx }, actor, {
    draftId: created.draft.id,
    content: content(TEXT),
  });
  return { seeded, actor, draftId: created.draft.id, version, matterId, proceedingId, workspaceId };
}

describe('draft consistency', () => {
  it('stores one report per version and graph revision', async () => {
    await withTestDb(async (tx) => {
      const { actor, version, proceedingId, workspaceId } = await setup(tx);
      const input = { draftVersionId: version.id };
      const first = await runConsistencyCheck({ db: tx }, actor, input);
      const again = await runConsistencyCheck({ db: tx }, actor, input);
      expect(again.id).toBe(first.id);
      expect(first.findings.map((f) => f.rule)).toEqual(
        expect.arrayContaining(['date.order_mismatch', 'annexure.missing']),
      );
      const order = first.findings.find((f) => f.rule === 'date.order_mismatch');
      expect(order).toMatchObject({ expected: '02/11/2026', found: '05/11/2026' });
      expect(order?.provenance.sourceType).toBeTruthy();

      // A new listing changes the graph facts: a new report, the old one kept.
      await inWorkspace(tx, workspaceId, (s) =>
        s.insert(schema.listing).values({
          workspaceId,
          proceedingId,
          listDate: '2026-12-01',
          listType: 'daily',
          stageRaw: 'FOR ORDERS',
          canonical: false,
          sourceType: 'manual',
        }),
      );
      const next = await runConsistencyCheck({ db: tx }, actor, input);
      expect(next.id).not.toBe(first.id);
      expect(next.graphRevision).not.toBe(first.graphRevision);
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.draftConsistencyReport)
          .where(eq(schema.draftConsistencyReport.draftVersionId, version.id)),
      );
      expect(rows).toHaveLength(2);
      // Both rows share the test transaction's timestamp, so either may be the newest here.
      expect([first.id, next.id]).toContain(
        (await getConsistencyReport({ db: tx }, actor, input))?.id,
      );
      const errors = await listFindings({ db: tx }, actor, { ...input, severity: 'error' });
      expect(errors.every((f) => f.severity === 'error')).toBe(true);
    });
  });

  it('maps annexure documents of the matter to P-n', async () => {
    await withTestDb(async (tx) => {
      const { actor, version, matterId, workspaceId } = await setup(tx);
      for (let n = 0; n < 2; n++) {
        const id = randomUUID();
        await inWorkspace(tx, workspaceId, (s) =>
          s.insert(schema.document).values({
            id,
            workspaceId,
            matterId,
            kind: 'annexure',
            storageKey: `ws/${workspaceId}/document/${id}`,
            sha256: createHash('sha256').update(id).digest('hex'),
          }),
        );
      }
      const report = await runConsistencyCheck({ db: tx }, actor, { draftVersionId: version.id });
      expect(report.findings.filter((f) => f.rule.startsWith('annexure.'))).toEqual([]);
    });
  });

  it('refuses applyFix without confirm and creates the next version with it', async () => {
    await withTestDb(async (tx) => {
      const { actor, version, draftId } = await setup(tx);
      const report = await runConsistencyCheck({ db: tx }, actor, { draftVersionId: version.id });
      const finding = report.findings.find((f) => f.rule === 'date.order_mismatch');
      expect(finding?.fix?.replacement).toBe('02/11/2026');
      const request = { draftVersionId: version.id, findingId: finding?.id ?? '' };
      for (const confirm of [undefined, false, 'true'] as const) {
        await expect(applyFix({ db: tx }, actor, { ...request, confirm })).rejects.toMatchObject({
          code: 'VALIDATION',
        });
      }
      expect(await listVersions({ db: tx }, actor, { draftId })).toHaveLength(2);
      const saved = await applyFix({ db: tx }, actor, { ...request, confirm: true });
      expect(saved.versionNo).toBe(version.versionNo + 1);
      const [row] = await inWorkspace(tx, actor.workspaceId, (s) =>
        s
          .select({ content: schema.draftVersion.content })
          .from(schema.draftVersion)
          .where(and(eq(schema.draftVersion.id, saved.id))),
      );
      expect(JSON.stringify(row?.content)).toContain('dated 02/11/2026');
      // The version that was checked is untouched.
      const [old] = await inWorkspace(tx, actor.workspaceId, (s) =>
        s
          .select({ content: schema.draftVersion.content })
          .from(schema.draftVersion)
          .where(eq(schema.draftVersion.id, version.id)),
      );
      expect(JSON.stringify(old?.content)).toContain('dated 05/11/2026');
    });
  });

  it("does not show a stranger's workspace the report", async () => {
    await withTestDb(async (tx) => {
      const { actor, version, seeded } = await setup(tx);
      await runConsistencyCheck({ db: tx }, actor, { draftVersionId: version.id });
      const stranger = { workspaceId: seeded.b.id, userId: seeded.ub };
      await expect(
        getConsistencyReport({ db: tx }, stranger, { draftVersionId: version.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
