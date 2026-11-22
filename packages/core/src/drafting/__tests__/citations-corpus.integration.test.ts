// The corpus resolver as the default of `checkDraft` (#1136), against Postgres: neutral citations and
// sections resolve through the stored corpus with no resolver passed, and the export gate holds every
// citation that is not `verified` (not_found, failed quote/pinpoint, throttled) until a member with
// `draft.export` acknowledges it with a reason. Acknowledged retryable rows are still re-resolved.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { createDb, inWorkspace, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMockResolver } from '@causedeck/drafting';
import { statuteKey } from '@causedeck/intelligence';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { seedCorpusJudgment } from '../../__tests__/cross-tenant/corpus-citations.fixture.ts';
import {
  acknowledgeUnverified,
  checkDraft,
  createDraft,
  exportDraft,
  saveVersion,
} from '../index.ts';

const { judgment, statuteAct, statuteSection, statuteSectionVersion } = schema;
const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
const created = { acts: [] as string[], sections: [] as string[] };

const SECRET_TEXT = 'Privileged fact 9c1e about the client.';
const REASON = 'Checked against the certified copy in the paper book';
const content = (text: string) => [{ type: 'paragraph', id: 'p1', text }];
const now = () => new Date('2026-11-20T06:00:00Z');

/** BNS s 106, committed by the owner unless already stored; afterAll removes only what it added. */
beforeAll(async () => {
  const key = statuteKey('BNS');
  const [inserted] = await owner
    .insert(statuteAct)
    .values({
      key,
      title: 'Bharatiya Nyaya Sanhita, 2023',
      shortName: 'BNS',
      inForceFrom: '2024-07-01',
      sourceNote: 'synthetic test fixture (#1136)',
      synthetic: true,
    })
    .onConflictDoNothing()
    .returning({ id: statuteAct.id });
  if (inserted !== undefined) created.acts.push(inserted.id);
  const [act] = await owner
    .select({ id: statuteAct.id })
    .from(statuteAct)
    .where(eq(statuteAct.key, key));
  if (act === undefined) throw new Error('BNS missing');
  const [section] = await owner
    .insert(statuteSection)
    .values({ actId: act.id, section: '106', heading: 'Causing death by negligence' })
    .onConflictDoNothing()
    .returning({ id: statuteSection.id });
  if (section !== undefined) {
    created.sections.push(section.id);
    await owner.insert(statuteSectionVersion).values({
      sectionId: section.id,
      text: 'Synthetic text.',
      validFrom: '2024-07-01',
      validTo: null,
      sourceNote: 'synthetic test fixture (#1136)',
      synthetic: true,
    });
  }
});

afterAll(async () => {
  for (const id of created.sections) {
    await owner.delete(statuteSectionVersion).where(eq(statuteSectionVersion.sectionId, id));
    await owner.delete(statuteSection).where(eq(statuteSection.id, id));
  }
  for (const id of created.acts) await owner.delete(statuteAct).where(eq(statuteAct.id, id));
  await owner.$client.end();
});

/** A masked judgment carrying a demo-form neutral citation (no title in the draft). */
async function seedNeutral(tx: Transaction, citation: string): Promise<void> {
  await tx.insert(judgment).values({
    sourceId: 'in.mhc.judgments',
    court: 'MHC',
    neutralCitation: citation,
    sha256: randomUUID().replaceAll('-', ''),
    provenance: {
      url: `https://mhc.example/j/${randomUUID()}.pdf`,
      fetchedAt: '2026-11-01T00:00:00.000Z',
      sha256: 'r',
      sourceId: 'in.mhc.judgments',
      sourceVersion: 'v1',
      tierUsed: 'http',
      costDollars: 0,
    },
    caseNumbers: [],
    caseTitle: 'X v. State of Tamil Nadu',
    titleMasked: true,
    pageText: [{ pageNo: 1, text: `${citation}\n1. Raw.` }],
    redactedText: [{ pageNo: 1, text: '1. The facts.' }],
  });
}

async function setup(tx: Transaction) {
  const seeded = await seedTwoTenants(tx);
  const workspaceId = seeded.a.id;
  const actor = { workspaceId, userId: seeded.ua };
  const [tpl] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.template)
      .values({
        workspaceId,
        code: `it.${randomUUID().slice(0, 8)}`,
        name: 'Citation template',
        kind: 'notice',
        courtPreset: 'madras_hc',
        blocks: content('Template body'),
      })
      .returning({ id: schema.template.id }),
  );
  /** A new draft whose first saved version holds `text`. */
  async function draft(text: string) {
    const made = await createDraft({ db: tx, now }, actor, {
      templateId: tpl?.id ?? '',
      title: 'Notice',
    });
    const version = await saveVersion({ db: tx }, actor, {
      draftId: made.draft.id,
      content: content(text),
    });
    return { draftId: made.draft.id, versionId: version.id };
  }
  return { actor, workspaceId, draft };
}

const neutral = () => `2026:MHC:${String(900000 + Math.floor(Math.random() * 99999))}`;

describe('checkDraft with the default corpus resolver', () => {
  it('verifies a neutral citation in the corpus without a title hint failure; an absent one is not_found', async () => {
    await withTestDb(async (tx) => {
      const { actor, draft } = await setup(tx);
      const present = neutral();
      const absent = `2026:MHC:${String(800000 + Math.floor(Math.random() * 99999))}`;
      await seedNeutral(tx, present);
      const { versionId } = await draft(`${SECRET_TEXT} As held in ${present}; contra ${absent}.`);
      const report = await checkDraft({ db: tx, now }, actor, versionId);
      expect(report.items.map((i) => [i.normalized, i.status, i.reason])).toEqual([
        [present, 'verified', undefined],
        [absent, 'not_found', undefined],
      ]);
    });
  });

  it('verifies a stored section and gives section_not_found for an unknown one', async () => {
    await withTestDb(async (tx) => {
      const { actor, draft } = await setup(tx);
      const { versionId } = await draft('The offence falls under s. 106 BNS, not s. 9999 BNS.');
      const report = await checkDraft({ db: tx, now }, actor, versionId);
      expect(report.items.map((i) => [i.kind, i.status, i.reason])).toEqual([
        ['section', 'verified', undefined],
        ['section', 'not_found', 'section_not_found'],
      ]);
    });
  });
});

describe('export gate over every unverified citation', () => {
  it('holds not_found and failed quote/pinpoint rows until acknowledged with a reason, and audits it', async () => {
    await withTestDb(async (tx) => {
      const { actor, workspaceId, draft } = await setup(tx);
      const j = await seedCorpusJudgment(tx);
      const cite = j.caseNumber.replace('W.P.No.', 'W.P. No. ');
      const absent = neutral();
      const { draftId, versionId } = await draft(
        [
          SECRET_TEXT,
          `In ${cite}, para 2, "${j.quote}".`,
          `Also ${cite}, para 99, "${j.quote}".`,
          `And ${cite}, para 2, "the duty is owed to nobody".`,
          `Contra ${absent}.`,
        ].join(' '),
      );
      const report = await checkDraft({ db: tx, now }, actor, versionId);
      expect(report.items.map((i) => [i.status, i.reason])).toEqual([
        ['verified', undefined],
        ['unknown', 'pinpoint_not_found'],
        ['unknown', 'quote_not_found'],
        ['not_found', undefined],
      ]);
      const verified = report.items.filter((i) => i.status === 'verified').map((i) => i.id);
      const held = report.items.filter((i) => i.status !== 'verified').map((i) => i.id);

      const enqueue = vi.fn(() => Promise.resolve(undefined));
      const input = { draftId, format: 'docx' as const };
      await expect(exportDraft({ db: tx, enqueue, now }, actor, input)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Acknowledge the citations that could not be verified before exporting',
      });
      // Acknowledging only some of them still holds the export.
      await acknowledgeUnverified({ db: tx, now }, actor, {
        draftVersionId: versionId,
        citationIds: held.slice(0, 1),
        reason: REASON,
      });
      await expect(exportDraft({ db: tx, enqueue, now }, actor, input)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      // A verified citation cannot be acknowledged.
      await expect(
        acknowledgeUnverified({ db: tx, now }, actor, {
          draftVersionId: versionId,
          citationIds: verified,
          reason: REASON,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await acknowledgeUnverified({ db: tx, now }, actor, {
        draftVersionId: versionId,
        citationIds: held.slice(1),
        reason: REASON,
      });
      expect(enqueue).not.toHaveBeenCalled();
      await expect(exportDraft({ db: tx, enqueue, now }, actor, input)).resolves.toMatchObject({
        status: 'queued',
      });

      const audit = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.workspaceId, workspaceId),
              eq(schema.auditEvent.action, 'draft.citations.acknowledged'),
            ),
          ),
      );
      expect(audit).toHaveLength(2);
      for (const row of audit) {
        expect(row.actorUserId).toBe(actor.userId);
        expect(Object.keys(row.metadata as object).sort()).toEqual([
          'acknowledgedAt',
          'citationIds',
          'count',
          'reason',
        ]);
        expect(JSON.stringify(row)).not.toContain('9c1e');
        expect(JSON.stringify(row)).not.toContain('passenger');
      }
      expect(audit.map((a) => (a.metadata as { count: number }).count).sort()).toEqual([1, 2]);
    });
  });

  it('holds a throttled row; once acknowledged it is still re-resolved on the next check', async () => {
    await withTestDb(async (tx) => {
      const { actor, workspaceId, draft } = await setup(tx);
      const { draftId, versionId } = await draft('As held in 2023 INSC 123.');
      const throttled = await checkDraft(
        { db: tx, now, resolver: { ...createMockResolver(), external: true }, dailyBudget: 0 },
        actor,
        versionId,
      );
      expect(throttled.items.map((i) => [i.status, i.reason])).toEqual([['unknown', 'throttled']]);
      const id = throttled.items[0]?.id ?? '';

      const enqueue = vi.fn(() => Promise.resolve(undefined));
      const input = { draftId, format: 'docx' as const };
      await expect(exportDraft({ db: tx, enqueue, now }, actor, input)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await acknowledgeUnverified({ db: tx, now }, actor, {
        draftVersionId: versionId,
        citationIds: [id],
        reason: REASON,
      });

      // The next check (default corpus resolver) retries it: the reason is no longer throttled and
      // the acknowledgement is kept.
      const retried = await checkDraft({ db: tx, now }, actor, versionId);
      expect(retried.items.map((i) => [i.id, i.status, i.reason])).toEqual([
        [id, 'not_found', undefined],
      ]);
      const [row] = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.authority).where(eq(schema.authority.id, id)),
      );
      expect(row?.ackBy).toBe(actor.userId);
      await expect(exportDraft({ db: tx, enqueue, now }, actor, input)).resolves.toMatchObject({
        status: 'queued',
      });
    });
  });

  it('gives a new version no statuses until it is checked', async () => {
    await withTestDb(async (tx) => {
      const { actor, draft } = await setup(tx);
      const { draftId, versionId } = await draft('As held in 2023 INSC 123.');
      await checkDraft({ db: tx, now }, actor, versionId);
      const next = await saveVersion({ db: tx }, actor, {
        draftId,
        content: content('As held in 2023 INSC 123.'),
      });
      const rows = await inWorkspace(tx, actor.workspaceId, (s) =>
        s.select().from(schema.authority).where(eq(schema.authority.draftVersionId, next.id)),
      );
      expect(rows).toEqual([]);
    });
  });
});
