// The grounded matter copilot (#1115): verified claims with server-computed pinpoints, a fabricated
// source or altered quote as unsupported, no authority, metering (one unit per request id, the Junior
// cap), a failing model call as an error, and an audit event of hashes and source ids only. Real
// database, the mock embedder and reranker, and a stubbed answer model.
import { randomUUID } from 'node:crypto';

import { createMockEmbedProvider } from '@causedeck/ai';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
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
});
