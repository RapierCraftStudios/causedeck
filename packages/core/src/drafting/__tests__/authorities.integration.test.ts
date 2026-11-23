// Authority insertion (#1142), against Postgres with the mock embedder and a stubbed answer model:
// propose returns only corpus candidates whose quote verifies against the stored redacted text and
// writes nothing; insert re-verifies (a tampered candidate gives VALIDATION, a stale base CONFLICT),
// saves the canonical paragraph as a new version and audits ids and a hash only; the inserted
// paragraph passes `checkDraft`, and an authority that stops verifying holds the export until it is
// acknowledged. Propose is metered once per request, capped on Junior and blocked on a sensitive matter.
import { randomUUID } from 'node:crypto';

import { createMockEmbedProvider } from '@causedeck/ai';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildMatter } from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { invalidateEntitlements } from '../../billing/index.ts';
import { getUsage, increment } from '../../usage/index.ts';
import {
  acknowledgeUnverified,
  checkDraft,
  createDraft,
  exportDraft,
  insertAuthority,
  proposeAuthorities,
  saveVersion,
} from '../index.ts';

const NOW = new Date('2026-11-20T06:30:00.000Z');
const now = () => NOW;
const REASON = 'Checked against the certified copy in the paper book';

/** A unique corpus passage per test, so committed corpus rows never answer for it. */
function passage() {
  const token = `zq${randomUUID().slice(0, 8)}`;
  const quote = `no written consent ${token} was taken before the surgery`;
  return {
    token,
    quote,
    question: `surgery without written consent ${token}`,
    text: `11. The patient was admitted.\n12. It is admitted that ${quote}.\n13. Costs follow.`,
  };
}

/** A masked judgment whose segment holds `segmentText` and whose redacted text holds `redacted`. */
async function seedJudgment(
  tx: Transaction,
  segmentText: string,
  redacted: string,
): Promise<{ id: string; citation: string }> {
  const sha256 = randomUUID().replaceAll('-', '');
  const citation = `2026:MHC:${String(700000 + Math.floor(Math.random() * 99999))}`;
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      neutralCitation: citation,
      judgmentDate: '2026-03-04',
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
      redactedText: [{ pageNo: 1, text: redacted }],
      redactionVersion: 1,
      segmentVersion: 1,
      segmentedRedactionVersion: 1,
      caseTitle: 'X v. State',
      titleMasked: true,
      courtLevel: 'high_court',
      outcome: 'allowed',
    })
    .returning({ id: schema.judgment.id });
  const id = row?.id ?? '';
  const embedder = createMockEmbedProvider();
  const { vectors } = await embedder.embed([segmentText]);
  await tx.insert(schema.judgmentSegment).values({
    judgmentId: id,
    ordinal: 1,
    role: 'facts',
    pageFrom: 1,
    pageTo: 1,
    text: segmentText,
    court: 'MHC',
    courtLevel: 'high_court',
    judgmentYear: 2026,
    embedding: vectors[0] ?? [],
    embeddingModel: embedder.modelVersion,
  });
  await tx.insert(schema.judgmentTag).values({
    judgmentId: id,
    subjectArea: 'medical_negligence',
    confidence: 0.9,
    modelVersion: 'test',
  });
  return { id, citation };
}

/** An answer model quoting `quote` from every corpus segment that holds it (and a fact, if any). */
function quoting(quote: string) {
  const answer = vi.fn((input: { sources: { id: string; text: string }[] }) =>
    Promise.resolve({
      claims: input.sources
        .filter((s) => s.text.includes(quote))
        .map((s) => ({ statement: 'Consent was not taken.', sourceId: s.id, quote })),
    }),
  );
  return answer;
}

async function setup(tx: Transaction, question: string, opts: { sensitive?: boolean } = {}) {
  await seedPlans(tx);
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const actor = { workspaceId, userId: ownerId };
  const [tpl] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.template)
      .values({
        workspaceId,
        code: `it.${randomUUID().slice(0, 8)}`,
        name: 'Authority template',
        kind: 'notice',
        courtPreset: 'madras_hc',
        blocks: [
          { type: 'heading', id: 'h1', level: 1, text: 'Submissions' },
          { type: 'paragraph', id: 'p1', text: question },
          { type: 'paragraph', id: 'p2', text: 'Closing.' },
        ],
      })
      .returning({ id: schema.template.id }),
  );
  const matterId =
    opts.sensitive === true
      ? (
          await inWorkspace(tx, workspaceId, (s) =>
            buildMatter(s, workspaceId, { title: 'Authority matter (fictional)', sensitive: true }),
          )
        ).id
      : null;
  const made = await createDraft({ db: tx, now }, actor, {
    templateId: tpl?.id ?? '',
    title: 'Notice',
    matterId,
  });
  const versions = () =>
    inWorkspace(tx, workspaceId, (s) =>
      s.select().from(schema.draftVersion).where(eq(schema.draftVersion.draftId, made.draft.id)),
    );
  const audit = (action: string) =>
    inWorkspace(tx, workspaceId, (s) =>
      s
        .select()
        .from(schema.auditEvent)
        .where(
          and(eq(schema.auditEvent.workspaceId, workspaceId), eq(schema.auditEvent.action, action)),
        ),
    );
  const usage = () => getUsage({ db: tx, workspaceId, now }, 'copilot.questions');
  return {
    actor,
    workspaceId,
    draftId: made.draft.id,
    versionId: made.version.id,
    versions,
    audit,
    usage,
  };
}

describe('proposeAuthorities', () => {
  it('returns only candidates verified against the stored text, with a pinpoint and the corpus link; writes nothing', async () => {
    await withTestDb(async (tx) => {
      const p = passage();
      const good = await seedJudgment(tx, p.text, p.text);
      // The segment holds the quote but the stored redacted text does not: never a candidate.
      const drifted = await seedJudgment(tx, p.text, '12. Something else entirely was recorded.');
      const ctx = await setup(tx, p.question);
      const before = await ctx.versions();

      const result = await proposeAuthorities(
        { db: tx, now, copilot: { answer: quoting(p.quote) } },
        ctx.actor,
        { draftId: ctx.draftId, blockId: 'p1', requestId: randomUUID() },
      );
      expect(result.aiBlocked).toBe(false);
      expect(result.noAuthority).toBe(false);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        candidateRef: { judgmentId: good.id, quote: p.quote, para: 12 },
        title: 'X v. State',
        neutralCitation: good.citation,
        paragraph: 12,
        page: 1,
      });
      expect(result.candidates[0]?.sourceUrl).toMatch(/^https:\/\/court\.example\//);
      expect(result.candidates.map((c) => c.candidateRef.judgmentId)).not.toContain(drifted.id);
      expect(await ctx.versions()).toEqual(before);
    });
  });

  it('says no authority when no corpus claim verifies', async () => {
    await withTestDb(async (tx) => {
      const p = passage();
      await seedJudgment(tx, p.text, p.text);
      const ctx = await setup(tx, p.question);
      const before = await ctx.versions();
      const result = await proposeAuthorities(
        { db: tx, now, copilot: { answer: quoting('a sentence no source holds') } },
        ctx.actor,
        { draftId: ctx.draftId, blockId: 'p1' },
      );
      expect(result).toMatchObject({ candidates: [], noAuthority: true, aiBlocked: false });
      expect(await ctx.versions()).toEqual(before);
    });
  });

  it('rejects a block with no text', async () => {
    await withTestDb(async (tx) => {
      const p = passage();
      const ctx = await setup(tx, p.question);
      await expect(
        proposeAuthorities({ db: tx, now, copilot: { answer: quoting(p.quote) } }, ctx.actor, {
          draftId: ctx.draftId,
          blockId: 'missing',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(await ctx.usage()).toBe(0);
    });
  });

  it('is metered once per request id and stopped at the Junior cap', async () => {
    await withTestDb(async (tx) => {
      const p = passage();
      await seedJudgment(tx, p.text, p.text);
      const ctx = await setup(tx, p.question);
      const deps = { db: tx, now, copilot: { answer: quoting(p.quote) } };
      const input = { draftId: ctx.draftId, blockId: 'p1', requestId: randomUUID() };
      const first = await proposeAuthorities(deps, ctx.actor, input);
      expect(first.usage).toEqual({ used: 1, limit: 30 });
      await proposeAuthorities(deps, ctx.actor, input);
      expect(await ctx.usage()).toBe(1);

      invalidateEntitlements(ctx.workspaceId);
      await increment({ db: tx, workspaceId: ctx.workspaceId, now }, 'copilot.questions', 29, {
        idempotencyKey: 'prior',
      });
      await expect(
        proposeAuthorities(deps, ctx.actor, { ...input, requestId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(await ctx.usage()).toBe(30);
    });
  });

  it('makes no model call and counts nothing for a sensitive matter', async () => {
    await withTestDb(async (tx) => {
      const p = passage();
      await seedJudgment(tx, p.text, p.text);
      const ctx = await setup(tx, p.question, { sensitive: true });
      const answer = quoting(p.quote);
      const result = await proposeAuthorities({ db: tx, now, copilot: { answer } }, ctx.actor, {
        draftId: ctx.draftId,
        blockId: 'p1',
      });
      expect(result).toMatchObject({ candidates: [], aiBlocked: true });
      expect(answer).not.toHaveBeenCalled();
      expect(await ctx.usage()).toBe(0);
      const calls = await inWorkspace(tx, ctx.workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, ctx.workspaceId)),
      );
      expect(calls).toEqual([]);
    });
  });
});

describe('insertAuthority', () => {
  it('rejects a tampered quote, judgment id or pinpoint and a stale version; nothing is saved', async () => {
    await withTestDb(async (tx) => {
      const p = passage();
      const good = await seedJudgment(tx, p.text, p.text);
      const ctx = await setup(tx, p.question);
      const before = await ctx.versions();
      const base = { draftId: ctx.draftId, versionId: ctx.versionId, afterBlockId: 'p1' };
      const tampered = [
        { judgmentId: good.id, quote: p.quote.replace('no written', 'a written'), para: 12 },
        { judgmentId: randomUUID(), quote: p.quote, para: 12 },
        { judgmentId: good.id, quote: p.quote, para: 11 },
        { judgmentId: good.id, quote: p.quote, para: 99 },
        { judgmentId: 'not-a-uuid', quote: p.quote, para: 12 },
        { judgmentId: good.id, quote: p.quote },
      ];
      for (const candidateRef of tampered) {
        await expect(
          insertAuthority({ db: tx, now }, ctx.actor, { ...base, candidateRef }),
        ).rejects.toMatchObject({ code: 'VALIDATION' });
      }
      await expect(
        insertAuthority({ db: tx, now }, ctx.actor, {
          ...base,
          afterBlockId: 'nope',
          candidateRef: { judgmentId: good.id, quote: p.quote, para: 12 },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(await ctx.versions()).toEqual(before);
      expect(await ctx.audit('draft.authority.inserted')).toEqual([]);

      // A base that is no longer the latest version.
      await saveVersion({ db: tx }, ctx.actor, {
        draftId: ctx.draftId,
        content: [{ type: 'paragraph', id: 'p1', text: p.question }],
      });
      await expect(
        insertAuthority({ db: tx, now }, ctx.actor, {
          ...base,
          candidateRef: { judgmentId: good.id, quote: p.quote, para: 12 },
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await ctx.versions()).toHaveLength(before.length + 1);
      expect(await ctx.audit('draft.authority.inserted')).toEqual([]);
    });
  });

  it('inserts the canonical paragraph as a new version that checkDraft verifies; audits a hash only', async () => {
    await withTestDb(async (tx) => {
      const p = passage();
      const good = await seedJudgment(tx, p.text, p.text);
      const ctx = await setup(tx, p.question);
      const before = await ctx.versions();
      const enqueueCitationCheck = vi.fn(() => Promise.resolve(undefined));

      const { version, blockId } = await insertAuthority(
        { db: tx, now, enqueueCitationCheck },
        ctx.actor,
        {
          draftId: ctx.draftId,
          versionId: ctx.versionId,
          afterBlockId: 'p1',
          candidateRef: { judgmentId: good.id, quote: p.quote, para: 12 },
        },
      );
      expect(version.versionNo).toBe(2);
      expect(enqueueCitationCheck).toHaveBeenCalledWith({
        workspaceId: ctx.workspaceId,
        draftVersionId: version.id,
      });
      const after = await ctx.versions();
      expect(after).toHaveLength(before.length + 1);
      // The earlier version is unchanged (immutable).
      expect(after.find((v) => v.id === ctx.versionId)).toEqual(before[0]);
      const saved = after.find((v) => v.id === version.id);
      expect(saved?.content).toEqual([
        { type: 'heading', id: 'h1', level: 1, text: 'Submissions' },
        { type: 'paragraph', id: 'p1', text: p.question },
        {
          type: 'paragraph',
          id: blockId,
          text: `"${p.quote}" — X v. State, ${good.citation}, para 12`,
        },
        { type: 'paragraph', id: 'p2', text: 'Closing.' },
      ]);

      const [event, ...more] = await ctx.audit('draft.authority.inserted');
      expect(more).toEqual([]);
      expect(event?.metadata).toMatchObject({
        draft_id: ctx.draftId,
        base_version_id: ctx.versionId,
        version_id: version.id,
        judgment_id: good.id,
      });
      expect(event?.metadata.text_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(event?.metadata)).not.toContain(p.token);
      // Insert sends nothing: no model call.
      const calls = await inWorkspace(tx, ctx.workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, ctx.workspaceId)),
      );
      expect(calls).toEqual([]);

      const report = await checkDraft({ db: tx, now }, ctx.actor, version.id);
      const inserted = report.items.filter((i) => i.blockId === blockId);
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({
        normalized: good.citation,
        status: 'verified',
        quoteChecked: 'verified',
        pinpoint: { para: 12 },
      });
    });
  });

  it('holds the export when the inserted authority stops verifying until it is acknowledged', async () => {
    await withTestDb(async (tx) => {
      const p = passage();
      const good = await seedJudgment(tx, p.text, p.text);
      const ctx = await setup(tx, p.question);
      const { blockId } = await insertAuthority({ db: tx, now }, ctx.actor, {
        draftId: ctx.draftId,
        versionId: ctx.versionId,
        afterBlockId: 'p1',
        candidateRef: { judgmentId: good.id, quote: p.quote, para: 12 },
      });
      // The stored text changes (a re-redaction): the quote no longer holds.
      await tx
        .update(schema.judgment)
        .set({ redactedText: [{ pageNo: 1, text: '12. The record now reads otherwise.' }] })
        .where(eq(schema.judgment.id, good.id));
      const [latest] = (await ctx.versions()).sort((a, b) => b.versionNo - a.versionNo);
      const report = await checkDraft({ db: tx, now }, ctx.actor, latest?.id ?? '');
      const held = report.items.filter((i) => i.blockId === blockId);
      expect(held).toHaveLength(1);
      expect(held[0]?.status).not.toBe('verified');

      const enqueue = vi.fn(() => Promise.resolve(undefined));
      const input = { draftId: ctx.draftId, format: 'docx' as const };
      await expect(exportDraft({ db: tx, enqueue, now }, ctx.actor, input)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await acknowledgeUnverified({ db: tx, now }, ctx.actor, {
        draftVersionId: latest?.id ?? '',
        citationIds: held.map((i) => i.id),
        reason: REASON,
      });
      expect(await ctx.audit('draft.citations.acknowledged')).toHaveLength(1);
      await expect(exportDraft({ db: tx, enqueue, now }, ctx.actor, input)).resolves.toMatchObject({
        status: 'queued',
      });
    });
  });
});
