// The grounded matter copilot (#1115): verified claims with server-computed pinpoints, a fabricated
// source or altered quote as unsupported, no authority, metering (one unit per request id, the Junior
// cap), a failing model call as an error, and an audit event of hashes and source ids only. Real
// database, the mock embedder and reranker, and a stubbed answer model.
import { randomUUID } from 'node:crypto';

import { createMockEmbedProvider, type AiGateway } from '@causedeck/ai';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildDocument,
  buildForum,
  buildListing,
  buildMatter,
  buildObligation,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../__tests__/fixtures.ts';
import { invalidateEntitlements } from '../billing/index.ts';
import { getUsage, increment } from '../usage/index.ts';

import { askCopilot } from './ask.ts';

const NOW = new Date('2026-10-31T06:30:00.000Z');
const TEXT =
  'The patient underwent a hysterectomy and no written consent was taken for the surgery.';

async function seedJudgment(tx: Transaction, text = TEXT): Promise<void> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      neutralCitation: `2019:MHC:${sha256.slice(0, 5)}`,
      judgmentDate: '2019-03-04',
      provenance: {
        url: `https://court.example/${sha256}.pdf`,
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [{ pageNo: 1, text: 'Raw text.' }],
      redactedText: [{ pageNo: 1, text }],
      redactionVersion: 1,
      segmentVersion: 1,
      segmentedRedactionVersion: 1,
      caseTitle: 'Rao v. Nursing Home',
      titleMasked: false,
      courtLevel: 'high_court',
      outcome: 'allowed',
    })
    .returning({ id: schema.judgment.id });
  const embedder = createMockEmbedProvider();
  const { vectors } = await embedder.embed([text]);
  await tx.insert(schema.judgmentSegment).values({
    judgmentId: row?.id ?? '',
    ordinal: 1,
    role: 'facts',
    pageFrom: 1,
    pageTo: 1,
    text,
    court: 'MHC',
    courtLevel: 'high_court',
    judgmentYear: 2019,
    embedding: vectors[0] ?? [],
    embeddingModel: embedder.modelVersion,
  });
  await tx.insert(schema.judgmentTag).values({
    judgmentId: row?.id ?? '',
    subjectArea: 'medical_negligence',
    confidence: 0.9,
    modelVersion: 'test',
  });
}

/** A matter with one document page carrying `text`, in `workspaceId`. */
async function matterWithPage(
  tx: Transaction,
  workspaceId: string,
  text: string,
  sensitive = false,
): Promise<{ matterId: string; documentId: string }> {
  return inWorkspace(tx, workspaceId, async (s) => {
    const matter = await buildMatter(s, workspaceId, {
      title: 'Copilot matter (fictional)',
      sensitive,
    });
    const doc = await buildDocument(s, workspaceId, { matterId: matter.id, kind: 'pleading' });
    await s.insert(schema.documentPage).values({
      workspaceId,
      documentId: doc.id,
      pageNo: 2,
      text,
      textSource: 'layer',
      lang: 'en',
    });
    return { matterId: matter.id, documentId: doc.id };
  });
}

/** A matter with a canonical future listing and one open obligation (#1167). */
async function matterWithCalendar(
  tx: Transaction,
  workspaceId: string,
): Promise<{ matterId: string; obligationId: string }> {
  return inWorkspace(tx, workspaceId, async (s) => {
    const matter = await buildMatter(s, workspaceId, { title: 'Calendar matter (fictional)' });
    const forum = await buildForum(s, workspaceId);
    const proceeding = await buildProceeding(s, workspaceId, {
      matterId: matter.id,
      forumId: forum.id,
      kind: 'main',
      number: '4521',
      year: 2026,
      state: 'numbered',
    });
    await buildListing(s, workspaceId, {
      proceedingId: proceeding.id,
      listDate: '2099-03-15',
      stageRaw: 'FOR ARGUMENTS',
      canonical: true,
      confirmationState: 'confirmed',
    });
    const obligation = await buildObligation(s, workspaceId, {
      matterId: matter.id,
      description: 'File the written arguments',
      dueDate: '2099-03-10',
    });
    return { matterId: matter.id, obligationId: obligation.id };
  });
}

const NEXT_DATE_QUESTION = 'What is the next date and what should I prepare?';
const AUDIT_KEYS = [
  'answer_sha256',
  'claims',
  'matter_id',
  'question_sha256',
  'source_ids',
  'unsupported',
];

const QUESTION = 'surgery without written consent';
const quoting = (quote: string, sourceId?: string) => (input: { sources: { id: string }[] }) =>
  Promise.resolve({
    claims: [
      { statement: 'Consent was not taken.', sourceId: sourceId ?? input.sources[0]?.id, quote },
    ],
  });

describe('askCopilot', () => {
  // #1132: a judgment segment with the court's numbered paragraphs gives `page N · para M`. The demo
  // corpus (packages/db/src/seed/demo/corpus.ts, its `Facts. / Issues. / Reasoning.` pages) has no
  // numbered paragraphs, so on the demo workspace a card correctly shows the page alone.
  it('pinpoints the numbered paragraph of a judgment segment that holds the quote', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seedJudgment(
        tx,
        `11. The patient was admitted for surgery.\n12. ${TEXT}\n13. Costs follow.`,
      );
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION },
        { now: () => NOW, answer: quoting('no written consent was taken') },
      );
      expect(answer.claims).toHaveLength(1);
      expect(answer.claims[0]).toMatchObject({ kind: 'seg', pinpoint: { page: 1, paragraph: 12 } });
    });
  });

  it('returns a verified claim with a server-computed pinpoint and the judgment link', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seedJudgment(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION },
        { now: () => NOW, answer: quoting('NO WRITTEN  consent was taken') },
      );
      expect(answer.claims).toHaveLength(1);
      expect(answer.claims[0]).toMatchObject({ kind: 'seg', pinpoint: { page: 1 } });
      expect(answer.unsupported).toEqual([]);
      const judgment = Object.values(answer.judgments)[0];
      expect(judgment?.sourceUrl).toMatch(/^https:\/\/court\.example\//);
    });
  });

  it('flags a fabricated source id and an altered quote as unsupported', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seedJudgment(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { workspaceId, userId: ownerId };
      const fake = await askCopilot(
        tx,
        actor,
        { question: QUESTION },
        {
          now: () => NOW,
          answer: quoting('no written consent', 'seg:00000000-0000-0000-0000-000000000000'),
        },
      );
      expect(fake.claims).toEqual([]);
      expect(fake.unsupported).toHaveLength(1);
      const altered = await askCopilot(
        tx,
        actor,
        { question: QUESTION },
        {
          now: () => NOW,
          answer: quoting('written consent was obtained'),
        },
      );
      expect(altered.claims).toEqual([]);
      expect(altered.unsupported[0]?.reason).toBe('quote_not_found');
      expect(altered.answerText).toBe('');
    });
  });

  it('says no authority when the corpus has nothing, and an empty claim list is no authority', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION },
        { now: () => NOW, answer: () => Promise.resolve({ claims: [] }) },
      );
      expect(answer.noAuthority).toBe(true);
      expect(answer.claims).toEqual([]);
    });
  });

  it('throws on a failing model call and counts nothing', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seedJudgment(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      await expect(
        askCopilot(
          tx,
          { workspaceId, userId: ownerId },
          { question: QUESTION },
          {
            now: () => NOW,
            answer: () => Promise.reject(new Error('provider down')),
          },
        ),
      ).rejects.toThrow('provider down');
      expect(await getUsage({ db: tx, workspaceId, now: () => NOW }, 'copilot.questions')).toBe(0);
    });
  });

  it('meters one unit per request id, audits hashes and source ids only', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seedJudgment(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { workspaceId, userId: ownerId };
      const deps = { now: () => NOW, answer: quoting('no written consent was taken') };
      const requestId = randomUUID();
      const first = await askCopilot(tx, actor, { question: QUESTION, requestId }, deps);
      expect(first.usage).toEqual({ used: 1, limit: 30 });
      await askCopilot(tx, actor, { question: QUESTION, requestId }, deps);
      expect(await getUsage({ db: tx, workspaceId, now: () => NOW }, 'copilot.questions')).toBe(1);

      const events = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'copilot.asked')),
      );
      expect(events.length).toBeGreaterThan(0);
      const audited = JSON.stringify(events.map((e) => e.metadata));
      expect(audited).not.toContain('surgery');
      expect(audited).not.toContain('hysterectomy');
      expect(events[0]?.metadata.question_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(events[0]?.metadata.answer_sha256).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('stops a Junior workspace at its monthly cap with a client-safe message', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seedJudgment(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      invalidateEntitlements(workspaceId);
      await increment({ db: tx, workspaceId, now: () => NOW }, 'copilot.questions', 30, {
        idempotencyKey: 'prior',
      });
      await expect(
        askCopilot(
          tx,
          { workspaceId, userId: ownerId },
          { question: QUESTION },
          {
            now: () => NOW,
            answer: quoting('no written consent'),
          },
        ),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(await getUsage({ db: tx, workspaceId, now: () => NOW }, 'copilot.questions')).toBe(30);
    });
  });

  it('blocks a sensitive matter before any provider call and counts nothing', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seedJudgment(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const { matterId } = await matterWithPage(
        tx,
        workspaceId,
        'Written consent was refused.',
        true,
      );
      let called = false;
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION, matterId },
        {
          now: () => NOW,
          answer: () => {
            called = true;
            return Promise.resolve({ claims: [] });
          },
        },
      );
      expect(answer.aiBlocked).toBe(true);
      expect(answer.answer).toBe('');
      expect(called).toBe(false);
      expect(await getUsage({ db: tx, workspaceId, now: () => NOW }, 'copilot.questions')).toBe(0);
      const calls = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, workspaceId)),
      );
      expect(calls).toEqual([]);
    });
  });

  it("quotes this matter's document page and never another matter's or workspace's", async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const mine = await matterWithPage(
        tx,
        workspaceId,
        'Written consent for surgery was never obtained.',
      );
      await matterWithPage(tx, workspaceId, 'OTHERMATTER written consent surgery secret.');
      const other = await newWorkspace(tx);
      await matterWithPage(tx, other.workspaceId, 'OTHERTENANT written consent surgery secret.');
      let shown = '';
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION, matterId: mine.matterId },
        {
          now: () => NOW,
          answer: (input: { sources: { id: string; text: string }[] }) => {
            shown = JSON.stringify(input.sources);
            return Promise.resolve({
              claims: [
                {
                  statement: 'Consent was never obtained.',
                  sourceId: `doc:${mine.documentId}:2`,
                  quote: 'consent for surgery was never obtained',
                },
              ],
            });
          },
        },
      );
      expect(shown).toContain('never obtained');
      expect(shown).not.toContain('OTHERMATTER');
      expect(shown).not.toContain('OTHERTENANT');
      expect(answer.claims[0]).toMatchObject({
        kind: 'doc',
        documentId: mine.documentId,
        pinpoint: { page: 2 },
      });
    });
  });

  it('goes through the core gateway and writes an ai_call row, with no source text in audit', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seedJudgment(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION },
        { now: () => NOW },
      );
      expect(answer.claims.length + answer.unsupported.length).toBeGreaterThan(0);
      const calls = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, workspaceId)),
      );
      expect(calls.map((c) => c.task)).toContain('answer_matter_question');
      const events = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'copilot.asked')),
      );
      expect(JSON.stringify(events)).not.toContain('hysterectomy');
    });
  });
  it('answers in a demo matter with verified claims and no model call or AI spend', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seedJudgment(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.organization)
          .set({ isDemo: true })
          .where(eq(schema.organization.id, workspaceId)),
      );
      const { matterId, documentId } = await matterWithPage(
        tx,
        workspaceId,
        'Written consent for surgery was never obtained.',
      );
      let called = false;
      const gateway = {
        run: () => {
          called = true;
          return Promise.reject(new Error('no AI call in a demo workspace'));
        },
      } as unknown as AiGateway;
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION, matterId },
        { now: () => NOW, gateway },
      );
      expect(called).toBe(false);
      expect(answer.noAuthority).toBe(false);
      expect(answer.unsupported).toEqual([]);
      expect(answer.claims.map((c) => c.kind).sort()).toEqual(['doc', 'seg']);
      expect(answer.claims.find((c) => c.kind === 'doc')).toMatchObject({
        documentId,
        pinpoint: { page: 2 },
      });
      const seg = answer.claims.find((c) => c.kind === 'seg');
      expect(seg?.pinpoint.page).toBe(1);
      expect(answer.judgments[seg?.judgmentId ?? '']?.sourceUrl).toMatch(/^https:\/\//);
      expect(answer.answerText).toContain('never obtained');
      expect(await getUsage({ db: tx, workspaceId, now: () => NOW }, 'copilot.questions')).toBe(1);
      const calls = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, workspaceId)),
      );
      expect(calls).toEqual([]);
    });
  });

  it("never shows the model a page of an ai_blocked capture's document", async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const { matterId } = await matterWithPage(
        tx,
        workspaceId,
        'Written consent for surgery was recorded.',
      );
      await inWorkspace(tx, workspaceId, async (s) => {
        const [cap] = await s
          .insert(schema.capture)
          .values({
            workspaceId,
            channel: 'upload',
            mime: 'application/pdf',
            sizeBytes: 8,
            originalFilename: 'blocked.pdf',
            createdBy: ownerId,
            status: 'ready',
            aiBlocked: true,
          })
          .returning();
        const doc = await buildDocument(s, workspaceId, {
          matterId,
          kind: 'pleading',
          sourceCaptureId: cap?.id ?? null,
        });
        await s.insert(schema.documentPage).values({
          workspaceId,
          documentId: doc.id,
          pageNo: 1,
          text: 'BLOCKEDCAPTURE written consent surgery.',
          textSource: 'layer',
          lang: 'en',
        });
      });
      let shown = '';
      await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION, matterId },
        {
          now: () => NOW,
          answer: (input: { sources: { id: string; text: string }[] }) => {
            shown = JSON.stringify(input.sources);
            return Promise.resolve({ claims: [] });
          },
        },
      );
      expect(shown).toContain('was recorded');
      expect(shown).not.toContain('BLOCKEDCAPTURE');
    });
  });

  it('answers the next-date question from matter facts on the mock gateway, metered once, audit unchanged (#1167)', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const { matterId, obligationId } = await matterWithCalendar(tx, workspaceId);
      const actor = { workspaceId, userId: ownerId };
      const requestId = randomUUID();
      const input = { question: NEXT_DATE_QUESTION, matterId, requestId };
      const answer = await askCopilot(tx, actor, input, { now: () => NOW });
      expect(answer.unsupported).toEqual([]);
      const cited = answer.claims.map((c) => c.sourceId);
      expect(cited).toContain('fact:next_date');
      expect(cited).toContain(`fact:obligation:${obligationId}`);
      expect(answer.claims.find((c) => c.sourceId === 'fact:next_date')?.quote).toContain(
        '2099-03-15',
      );
      expect(answer.answer).toMatch(/^Next date: 2099-03-15\. Stage: FOR ARGUMENTS\. \[1\]/);
      expect(answer.answer).toContain('File the written arguments');
      const markers = [...answer.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      expect(markers.every((n) => n >= 1 && n <= answer.claims.length)).toBe(true);
      expect(answer.answerText).toBe(answer.claims.map((c) => c.statement).join(' '));

      await askCopilot(tx, actor, input, { now: () => NOW });
      expect(await getUsage({ db: tx, workspaceId, now: () => NOW }, 'copilot.questions')).toBe(1);
      const calls = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, workspaceId)),
      );
      expect(calls.map((c) => c.task)).toContain('answer_matter_question');
      const events = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'copilot.asked')),
      );
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(Object.keys(e.metadata).sort()).toEqual(AUDIT_KEYS);
        expect(JSON.stringify(e.metadata)).not.toContain('written arguments');
      }
    });
  });

  it('keeps only the markers of verified claims of a gateway reply and renumbers them (#1167)', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const { matterId, obligationId } = await matterWithCalendar(tx, workspaceId);
      let shown: string[] = [];
      const gateway = {
        run: (_task: string, input: { sources: { id: string }[] }) => {
          shown = input.sources.map((s) => s.id);
          return Promise.resolve({
            output: {
              claims: [
                {
                  statement: 'Listed on 15 March 2099.',
                  sourceId: 'fact:next_date',
                  quote: 'Next date: 2099-03-15',
                },
                {
                  statement: 'Judgment reserved.',
                  sourceId: 'fact:next_date',
                  quote: 'judgment reserved',
                },
                {
                  statement: 'Written arguments are due first.',
                  sourceId: `fact:obligation:${obligationId}`,
                  quote: 'File the written arguments',
                },
              ],
              answer:
                'The matter is next listed on 15 March 2099 [1, 2]. Before that, file the written arguments [3] [4].',
            },
          });
        },
      } as unknown as AiGateway;
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: NEXT_DATE_QUESTION, matterId },
        { now: () => NOW, gateway },
      );
      expect(shown).toEqual(
        expect.arrayContaining([
          'fact:next_date',
          'fact:stage',
          'fact:obligations',
          `fact:obligation:${obligationId}`,
        ]),
      );
      expect(answer.claims.map((c) => c.sourceId)).toEqual([
        'fact:next_date',
        `fact:obligation:${obligationId}`,
      ]);
      expect(answer.unsupported.map((u) => u.reason)).toEqual(['quote_not_found']);
      expect(answer.answer).toBe(
        'The matter is next listed on 15 March 2099 [1]. Before that, file the written arguments [2].',
      );
      expect(answer.answerText).toBe('Listed on 15 March 2099. Written arguments are due first.');
      expect(await getUsage({ db: tx, workspaceId, now: () => NOW }, 'copilot.questions')).toBe(1);
    });
  });
});
