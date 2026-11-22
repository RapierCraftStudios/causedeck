// The grounded matter copilot (#1115): verified claims with server-computed pinpoints, a fabricated
// source or altered quote as unsupported, no authority, metering (one unit per request id, the Junior
// cap), a failing model call as an error, and an audit event of hashes and source ids only. Real
// database, the mock embedder and reranker, and a stubbed answer model.
import { randomUUID } from 'node:crypto';

import { createMockEmbedProvider, type AiGateway } from '@causedeck/ai';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildDocument, buildMatter } from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../__tests__/fixtures.ts';
import { invalidateEntitlements } from '../billing/index.ts';
import { getUsage, increment } from '../usage/index.ts';

import { askCopilot } from './ask.ts';

const NOW = new Date('2026-10-31T06:30:00.000Z');
const TEXT =
  'The patient underwent a hysterectomy and no written consent was taken for the surgery.';

async function seedJudgment(tx: Transaction): Promise<void> {
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
      redactedText: [{ pageNo: 1, text: TEXT }],
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
  const { vectors } = await embedder.embed([TEXT]);
  await tx.insert(schema.judgmentSegment).values({
    judgmentId: row?.id ?? '',
    ordinal: 1,
    role: 'facts',
    pageFrom: 1,
    pageTo: 1,
    text: TEXT,
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

const QUESTION = 'surgery without written consent';
const quoting = (quote: string, sourceId?: string) => (input: { sources: { id: string }[] }) =>
  Promise.resolve({
    claims: [
      { statement: 'Consent was not taken.', sourceId: sourceId ?? input.sources[0]?.id, quote },
    ],
  });

describe('askCopilot', () => {
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
});
