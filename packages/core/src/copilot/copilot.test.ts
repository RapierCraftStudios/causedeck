// The grounded matter copilot (#1115): verified claims with server-computed pinpoints, a fabricated
// source or altered quote as unsupported, no authority, metering (one unit per request id, the Junior
// cap), a failing model call as an error, and an audit event of hashes and source ids only. Real
// database, the mock embedder and reranker, and a stubbed answer model.
import { randomUUID } from 'node:crypto';

import {
  createChatgptPlanProvider,
  createMockEmbedProvider,
  type AiGateway,
  type Provider,
} from '@causedeck/ai';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildDocument, buildMatter } from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { newWorkspace } from '../__tests__/fixtures.ts';
import { invalidateEntitlements } from '../billing/index.ts';
import { getUsage, increment } from '../usage/index.ts';

import { askCopilot, PLAN_LIMIT_MESSAGE } from './ask.ts';

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

// #1165: the preview-only chatgpt-plan provider, over a mocked Responses API stream.
describe('askCopilot with the preview plan provider', () => {
  const ACCESS = 'plan-access-token';
  const sse = (events: unknown[]): Response =>
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  const completed = (text: string): Response =>
    sse([
      { type: 'response.output_text.delta', delta: text },
      {
        type: 'response.completed',
        response: {
          model: 'gpt-plan-test',
          output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
          usage: { input_tokens: 400, output_tokens: 40 },
        },
      },
    ]);
  /** Replies with one claim on the request's `doc:` source, quoting `quote` (or a fabricated id). */
  function planWith(reply: (body: string) => Response) {
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) =>
      Promise.resolve(reply(init?.body as string)),
    );
    const provider: Provider = createChatgptPlanProvider({
      model: 'gpt-plan-test',
      tokens: { accessToken: () => Promise.resolve(ACCESS), invalidate: () => undefined },
      fetch,
      retry: { maxAttempts: 1, sleep: () => Promise.resolve() },
    });
    return { fetch, provider };
  }
  const claiming = (quote: string, sourceId?: string) => (body: string) => {
    const id = sourceId ?? /doc:[0-9a-f-]+:2/.exec(body)?.[0] ?? 'missing';
    return completed(
      JSON.stringify({ claims: [{ statement: 'Consent was not taken.', sourceId: id, quote }] }),
    );
  };

  async function previewWorkspace(tx: Transaction, demo = true) {
    await seedPlans(tx);
    const ws = await newWorkspace(tx);
    if (demo) {
      await inWorkspace(tx, ws.workspaceId, (s) =>
        s
          .update(schema.organization)
          .set({ isDemo: true, slug: `demo-${ws.workspaceId.slice(0, 8)}` })
          .where(eq(schema.organization.id, ws.workspaceId)),
      );
    }
    const page = await matterWithPage(
      tx,
      ws.workspaceId,
      'Written consent for surgery was never obtained.',
    );
    return { ...ws, ...page };
  }
  const aiCalls = (tx: Transaction, workspaceId: string) =>
    inWorkspace(tx, workspaceId, (s) =>
      s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, workspaceId)),
    );

  it('answers a demo workspace with model-written, verified claims and audits chatgpt-plan', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, matterId, documentId } = await previewWorkspace(tx);
      const { fetch, provider } = planWith(claiming('consent for surgery was never obtained'));
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION, matterId },
        { now: () => NOW, previewPlanProvider: provider },
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({ store: false, stream: true });
      expect(answer.unsupported).toEqual([]);
      expect(answer.claims).toHaveLength(1);
      expect(answer.claims[0]).toMatchObject({
        kind: 'doc',
        documentId,
        statement: 'Consent was not taken.',
        pinpoint: { page: 2 },
      });
      const calls = await aiCalls(tx, workspaceId);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        provider: 'chatgpt-plan',
        model: 'gpt-plan-test',
        status: 'ok',
        costPaise: 0,
      });
      const row = JSON.stringify(calls);
      expect(row).not.toContain('never obtained');
      expect(row).not.toContain(ACCESS);
    });
  });

  it.each([
    ['a fabricated source id', 'consent for surgery was never obtained', 'doc:fabricated:9'],
    ['an altered quote', 'consent for surgery was duly obtained', undefined],
  ])('marks %s unsupported, never verified (D-004)', async (_name, quote, sourceId) => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, matterId } = await previewWorkspace(tx);
      const { provider } = planWith(claiming(quote, sourceId));
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION, matterId },
        { now: () => NOW, previewPlanProvider: provider },
      );
      expect(answer.claims).toEqual([]);
      expect(answer.unsupported).toHaveLength(1);
    });
  });

  it('turns the plan usage limit into RATE_LIMITED with a client-safe message and counts nothing', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, matterId } = await previewWorkspace(tx);
      const { provider } = planWith(
        () =>
          new Response(
            JSON.stringify({
              error: { code: 'subscription_sharing_usage_limit_exceeded', message: ACCESS },
            }),
            { status: 429 },
          ),
      );
      const error = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION, matterId },
        { now: () => NOW, previewPlanProvider: provider },
      ).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'RATE_LIMITED', message: PLAN_LIMIT_MESSAGE });
      expect((error as Error).message).not.toContain(ACCESS);
      expect(await getUsage({ db: tx, workspaceId, now: () => NOW }, 'copilot.questions')).toBe(0);
    });
  });

  it('never calls the plan for a non-demo workspace: the default gateway path is unchanged', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, matterId } = await previewWorkspace(tx, false);
      const { fetch, provider } = planWith(claiming('consent for surgery was never obtained'));
      await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION, matterId },
        { now: () => NOW, previewPlanProvider: provider },
      );
      expect(fetch).not.toHaveBeenCalled();
      const calls = await aiCalls(tx, workspaceId);
      expect(calls.map((c) => c.provider)).toEqual(['mock']);
    });
  });

  it('a demo workspace without a demo slug still answers extractively', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, matterId } = await previewWorkspace(tx, false);
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.organization)
          .set({ isDemo: true })
          .where(eq(schema.organization.id, workspaceId)),
      );
      const { fetch, provider } = planWith(claiming('consent for surgery was never obtained'));
      const answer = await askCopilot(
        tx,
        { workspaceId, userId: ownerId },
        { question: QUESTION, matterId },
        { now: () => NOW, previewPlanProvider: provider },
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(answer.answerText).toContain('never obtained');
      expect(await aiCalls(tx, workspaceId)).toEqual([]);
    });
  });
});
