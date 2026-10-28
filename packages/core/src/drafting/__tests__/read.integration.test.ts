// Drafting read services against Postgres (#824): the list with citation and consistency counts, the
// draft with its latest blocks and versions, the template ranking, a clerk and another workspace
// denied, and no draft text in the summaries.
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMockResolver } from '@causedeck/drafting';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../../shared/errors.ts';
import { checkDraft, createDraft, saveVersion } from '../index.ts';
import { courtToPreset, getDraft, listDrafts, listTemplates, rankTemplates } from '../read.ts';

const SECRET_TEXT = 'Privileged fact 7f3a about the client.';
const content = (text: string) => [{ type: 'paragraph', id: 'p1', text }];
const now = () => new Date('2026-05-01T06:00:00Z');

async function setup(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const seeded = await seedTwoTenants(tx);
  const workspaceId = seeded.a.id;
  const [tpl] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.template)
      .values({
        workspaceId,
        code: `it.${randomUUID().slice(0, 8)}`,
        name: 'Read template',
        kind: 'notice',
        courtPreset: 'generic',
        blocks: content('Template body'),
      })
      .returning({ id: schema.template.id }),
  );
  const actor = { workspaceId, userId: seeded.ua };
  const created = await createDraft({ db: tx, now }, actor, {
    templateId: tpl?.id ?? '',
    title: 'Notice',
  });
  return { seeded, actor, created, workspaceId };
}

describe('drafting read services', () => {
  it('lists drafts with counts and no text, and opens the latest version with its history', async () => {
    await withTestDb(async (tx) => {
      const { seeded, actor, created, workspaceId } = await setup(tx);
      const v2 = await saveVersion({ db: tx }, actor, {
        draftId: created.draft.id,
        content: content(
          `${SECRET_TEXT} In Ramesh Kumar v. State of Kerala, 2023 INSC 123 and 2099 INSC 999.`,
        ),
      });
      await checkDraft({ db: tx, resolver: createMockResolver(), now }, actor, v2.id);
      await inWorkspace(tx, workspaceId, (s) =>
        s.insert(schema.draftConsistencyReport).values({
          workspaceId,
          draftVersionId: v2.id,
          graphRevision: 'a'.repeat(64),
          report: { counts: { error: 1, warn: 2, info: 3 }, findings: [] },
        }),
      );

      const all = await listDrafts({ db: tx }, actor);
      const list = all.filter((d) => d.id === created.draft.id);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: created.draft.id,
        title: 'Notice',
        templateName: 'Read template',
        latestVersionNo: 2,
        citations: { verified: 1, not_found: 1, unknown: 0 },
        consistency: { error: 1, warn: 2, info: 3 },
      });
      expect(JSON.stringify(list)).not.toContain('7f3a');
      await expect(
        listDrafts({ db: tx }, actor, { matterId: randomUUID() }),
      ).rejects.toBeInstanceOf(WorkspaceError);

      const detail = await getDraft({ db: tx }, actor, { draftId: created.draft.id });
      expect(detail.version.versionNo).toBe(2);
      expect(JSON.stringify(detail.version.blocks)).toContain('7f3a');
      expect(detail.versions.map((v) => v.versionNo)).toEqual([2, 1]);

      const ofB = await listDrafts({ db: tx }, { workspaceId: seeded.b.id, userId: seeded.ub });
      expect(ofB.map((d) => d.id)).not.toContain(created.draft.id);
    });
  });

  it('denies a clerk and another workspace', async () => {
    await withTestDb(async (tx) => {
      const { seeded, actor, created, workspaceId } = await setup(tx);
      const clerkId = seeded.a.rows.member?.userId ?? '';
      await tx
        .update(schema.member)
        .set({ role: 'clerk' })
        .where(eq(schema.member.userId, clerkId));
      const clerk = { workspaceId, userId: clerkId };
      const input = { draftId: created.draft.id };
      await expect(listDrafts({ db: tx }, clerk)).rejects.toBeInstanceOf(WorkspaceError);
      await expect(getDraft({ db: tx }, clerk, input)).rejects.toBeInstanceOf(WorkspaceError);
      await expect(listTemplates({ db: tx }, clerk)).rejects.toBeInstanceOf(WorkspaceError);
      const other = { workspaceId, userId: seeded.ub };
      await expect(getDraft({ db: tx }, other, input)).rejects.toBeInstanceOf(WorkspaceError);
      await expect(getDraft({ db: tx }, actor, { draftId: 'nope' })).rejects.toBeInstanceOf(
        WorkspaceError,
      );
    });
  });

  it('returns at most five enabled system templates', async () => {
    await withTestDb(async (tx) => {
      const { actor } = await setup(tx);
      const found = await listTemplates({ db: tx }, actor);
      expect(found.length).toBeLessThanOrEqual(5);
    });
  });
});

describe('template ranking', () => {
  const t = (code: string, courtPreset: string, name = code) => ({ code, courtPreset, name });

  it('maps court names to presets', () => {
    expect(courtToPreset('Madras High Court')).toBe('madras_hc');
    expect(courtToPreset('High Court of Karnataka')).toBe('karnataka_hc');
    expect(courtToPreset('Some Tribunal')).toBeNull();
    expect(courtToPreset(undefined)).toBeNull();
  });

  it('puts the matter court first, then generic, then the rest by name', () => {
    const all = [
      t('d', 'delhi_hc', 'D'),
      t('g', 'generic', 'G'),
      t('m2', 'madras_hc', 'B'),
      t('m1', 'madras_hc', 'A'),
      t('k', 'karnataka_hc', 'K'),
    ];
    expect(rankTemplates(all, 'madras_hc').map((x) => x.code)).toEqual(['m1', 'm2', 'g', 'd', 'k']);
    expect(rankTemplates(all, null).map((x) => x.code)).toEqual(['g', 'm1', 'm2', 'd', 'k']);
  });
});
