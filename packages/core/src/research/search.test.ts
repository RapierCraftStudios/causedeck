// Fact-pattern search (#896): the service over a real database, the mock embedder, reranker and
// planner. Covers retrieval by facts and by statute (IPC 304A found by BNS 106), the redaction
// invariant with a seeded sentinel party name (D-053), metering and the Junior cap, the audit event
// (ids and hashes, never the query), re-running with an edited plan, and the verified answer.
import { randomUUID } from 'node:crypto';

import { createMockEmbedProvider } from '@causedeck/ai';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { newUser, newWorkspace } from '../__tests__/fixtures.ts';
import { invalidateEntitlements } from '../billing/index.ts';
import { getUsage, increment } from '../usage/index.ts';

import { rerunAuthoritySearch, searchAuthorities } from './search.ts';

const SENTINEL = 'Zorblax Industries';
const NOW = new Date('2026-10-31T06:30:00.000Z');

interface Seed {
  negligence: string;
  ndps: string;
  citing: string;
}

async function seedJudgment(
  tx: Transaction,
  v: {
    title: string;
    titleMasked?: boolean;
    court?: string;
    level?: string;
    year?: number;
    outcome?: 'allowed' | 'dismissed' | 'unknown';
    tag?: string;
    statute?: [string, string];
    segments: { role: 'facts' | 'reasoning' | 'decision'; text: string }[];
  },
): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const year = v.year ?? 2019;
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: v.court ?? 'MHC',
      sha256,
      neutralCitation: `${String(year)}:MHC:${sha256.slice(0, 5)}`,
      judgmentDate: `${String(year)}-03-04`,
      provenance: {
        url: `https://court.example/${sha256}.pdf`,
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      // The raw text carries a party name; only the redacted text and segments may be served.
      pageText: [{ pageNo: 1, text: `${SENTINEL} v. the patient. Raw text.` }],
      redactedText: [{ pageNo: 1, text: '[PARTY] v. [PARTY]. Redacted text.' }],
      redactionVersion: 1,
      segmentVersion: 1,
      segmentedRedactionVersion: 1,
      caseTitle: v.title,
      titleMasked: v.titleMasked ?? false,
      courtLevel: v.level ?? 'high_court',
      outcome: v.outcome ?? 'unknown',
    })
    .returning({ id: schema.judgment.id });
  const judgmentId = row?.id ?? '';
  const embedder = createMockEmbedProvider();
  const { vectors } = await embedder.embed(v.segments.map((s) => s.text));
  await tx.insert(schema.judgmentSegment).values(
    v.segments.map((s, i) => ({
      judgmentId,
      ordinal: i + 1,
      role: s.role,
      pageFrom: 1,
      pageTo: 1,
      text: s.text,
      court: v.court ?? 'MHC',
      courtLevel: v.level ?? 'high_court',
      judgmentYear: year,
      embedding: vectors[i] ?? [],
      embeddingModel: embedder.modelVersion,
    })),
  );
  if (v.tag !== undefined) {
    await tx.insert(schema.judgmentTag).values({
      judgmentId,
      subjectArea: v.tag,
      confidence: 0.9,
      modelVersion: 'test',
    });
  }
  if (v.statute !== undefined) {
    await tx.insert(schema.judgmentStatuteRef).values({
      judgmentId,
      statute: v.statute[0],
      section: v.statute[1],
      page: 1,
      rulesetVersion: 'enrich-1',
    });
  }
  return judgmentId;
}

async function seed(tx: Transaction): Promise<Seed> {
  const negligence = await seedJudgment(tx, {
    title: 'Meera Rao v. Sunrise Nursing Home',
    outcome: 'allowed',
    tag: 'medical_negligence',
    statute: ['indian penal code', '304a'],
    segments: [
      {
        role: 'facts',
        text: 'The patient underwent a hysterectomy and no written consent was taken for the surgery.',
      },
      {
        role: 'reasoning',
        text: 'A post-operative infection set in and the hospital delayed antibiotics. This is medical negligence.',
      },
    ],
  });
  const ndps = await seedJudgment(tx, {
    title: 'State v. [MASKED]',
    titleMasked: true,
    tag: 'ndps',
    statute: ['narcotic drugs and psychotropic substances act', '37'],
    segments: [
      {
        role: 'reasoning',
        text: 'Bail under section 37 of the NDPS Act needs the twin conditions for a commercial quantity.',
      },
    ],
  });
  const citing = await seedJudgment(tx, {
    title: 'Citing judgment',
    segments: [{ role: 'reasoning', text: 'Unrelated tax appeal on assessment.' }],
  });
  await tx.insert(schema.judgmentCitationRef).values({
    judgmentId: citing,
    rawCitation: 'x',
    normalisedCitation: `x-${randomUUID()}`,
    citedJudgmentId: negligence,
    page: 1,
    rulesetVersion: 'enrich-1',
  });
  return { negligence, ndps, citing };
}

const deps = (extra: Parameters<typeof searchAuthorities>[3] = {}) => ({
  now: () => NOW,
  ...extra,
});

describe('searchAuthorities', () => {
  it('finds judgments by fact pattern with court, citation, roles, outcome and cited-by', async () => {
    await withTestDb(async (tx) => {
      const ids = await seed(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const result = await searchAuthorities(
        tx,
        { workspaceId, userId: ownerId },
        { query: 'surgery without written consent and post-operative infection' },
        deps(),
      );
      const hit = result.hits[0];
      expect(hit?.judgmentId).toBe(ids.negligence);
      expect(hit).toMatchObject({
        court: 'MHC',
        courtLevel: 'high_court',
        outcome: 'allowed',
        citedByCount: 1,
        title: 'Meera Rao v. Sunrise Nursing Home',
      });
      expect(hit?.neutralCitation).toMatch(/^2019:MHC:/);
      expect(hit?.sourceUrl).toMatch(/^https:\/\/court\.example\//);
      expect(hit?.segments.map((s) => s.role).sort()).toEqual(['facts', 'reasoning']);
      expect(result.counts.reranked).toBe(true);
      expect(result.counts.vector).toBeGreaterThan(0);
    });
  });

  it('never returns a party name from the raw page text', async () => {
    await withTestDb(async (tx) => {
      await seed(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const result = await searchAuthorities(
        tx,
        { workspaceId, userId: ownerId },
        { query: 'patient redacted text surgery consent', answer: true },
        deps(),
      );
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
    });
  });

  it('a BNS 106 search finds the IPC 304A judgment and a statute filter excludes the rest', async () => {
    await withTestDb(async (tx) => {
      const ids = await seed(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const result = await searchAuthorities(
        tx,
        { workspaceId, userId: ownerId },
        { query: 'BNS 106 negligence of hospital' },
        deps(),
      );
      expect(result.plan.statutes).toEqual([
        { statute: 'bharatiya nyaya sanhita', section: '106' },
      ]);
      expect(result.hits.map((h) => h.judgmentId)).toEqual([ids.negligence]);
    });
  });

  it('applies the court, date and outcome filters of an edited plan and does not re-plan', async () => {
    await withTestDb(async (tx) => {
      const ids = await seed(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { workspaceId, userId: ownerId };
      const plan = vi.fn(() => Promise.resolve({}));
      const first = await searchAuthorities(
        tx,
        actor,
        { query: 'medical negligence consent infection' },
        deps({ plan }),
      );
      expect(plan).toHaveBeenCalledTimes(1);
      expect(first.hits.map((h) => h.judgmentId)).toContain(ids.negligence);

      const edited = { ...first.plan, subjectAreas: [], courts: ['KHC'] };
      const none = await rerunAuthoritySearch(tx, actor, { plan: edited }, deps({ plan }));
      expect(none.hits).toEqual([]);
      const some = await rerunAuthoritySearch(
        tx,
        actor,
        {
          plan: {
            ...edited,
            courts: ['MHC'],
            dateFrom: '2019-01-01',
            dateTo: '2019-12-31',
            outcome: 'allowed',
          },
        },
        deps({ plan }),
      );
      expect(some.hits.map((h) => h.judgmentId)).toEqual([ids.negligence]);
      expect(plan).toHaveBeenCalledTimes(1);
      const dismissed = await rerunAuthoritySearch(
        tx,
        actor,
        { plan: { ...edited, courts: [], outcome: 'dismissed' } },
        deps({ plan }),
      );
      expect(dismissed.hits).toEqual([]);
    });
  });

  it('keeps a masked title in its stored masked form', async () => {
    await withTestDb(async (tx) => {
      const ids = await seed(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const result = await searchAuthorities(
        tx,
        { workspaceId, userId: ownerId },
        { query: 'bail NDPS commercial quantity section 37' },
        deps(),
      );
      const hit = result.hits.find((h) => h.judgmentId === ids.ndps);
      expect(hit).toMatchObject({ titleMasked: true, title: 'State v. [MASKED]' });
    });
  });

  it('meters one search, audits ids and hashes only, and re-runs are not metered', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seed(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { workspaceId, userId: ownerId };
      const query = 'surgery without written consent';
      const first = await searchAuthorities(tx, actor, { query }, deps());
      expect(first.usage).toEqual({ used: 1, limit: 30 });
      await rerunAuthoritySearch(tx, actor, { plan: first.plan }, deps());
      const ctx = { db: tx, workspaceId, now: () => NOW };
      expect(await getUsage(ctx, 'research.searches')).toBe(1);

      const events = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'research.searched')),
      );
      expect(events.map((e) => e.metadata.mode).sort()).toEqual(['rerun', 'search']);
      const audited = JSON.stringify(events.map((e) => e.metadata));
      expect(audited).not.toContain('surgery');
      expect(events[0]?.metadata.judgment_ids).toContain(first.hits[0]?.judgmentId ?? '#');
      expect(events[0]?.metadata.query_sha256).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('stops a Junior workspace at its monthly cap and spends nothing', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seed(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      invalidateEntitlements(workspaceId);
      const ctx = { db: tx, workspaceId, now: () => NOW };
      await increment(ctx, 'research.searches', 30, { idempotencyKey: 'prior' });
      const embed = createMockEmbedProvider();
      const spy = vi.spyOn(embed, 'embed');
      await expect(
        searchAuthorities(
          tx,
          { workspaceId, userId: ownerId },
          { query: 'surgery consent' },
          deps(),
        ),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(spy).not.toHaveBeenCalled();
      expect(await getUsage(ctx, 'research.searches')).toBe(30);
    });
  });

  it('counts a retried request once', async () => {
    await withTestDb(async (tx) => {
      await seedPlans(tx);
      await seed(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { workspaceId, userId: ownerId };
      const requestId = randomUUID();
      await searchAuthorities(tx, actor, { query: 'surgery consent', requestId }, deps());
      await searchAuthorities(tx, actor, { query: 'surgery consent', requestId }, deps());
      expect(await getUsage({ db: tx, workspaceId, now: () => NOW }, 'research.searches')).toBe(1);
    });
  });

  it('refuses a non-member, an empty query and an invalid edited plan', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, ownerId } = await newWorkspace(tx);
      const stranger = await newUser(tx);
      await expect(
        searchAuthorities(tx, { workspaceId, userId: stranger }, { query: 'surgery' }, deps()),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        searchAuthorities(tx, { workspaceId, userId: ownerId }, { query: '   ' }, deps()),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        rerunAuthoritySearch(
          tx,
          { workspaceId, userId: ownerId },
          { plan: { query: 'x' } },
          deps(),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  it('answers with verified quotes on the mock, and no matching authority when nothing matches', async () => {
    await withTestDb(async (tx) => {
      await seed(tx);
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const actor = { workspaceId, userId: ownerId };
      const answered = await searchAuthorities(
        tx,
        actor,
        { query: 'hospital delayed antibiotics post-operative infection', answer: true },
        deps(),
      );
      expect(answered.answer?.claims.length).toBeGreaterThan(0);
      expect(answered.answer?.claims.every((c) => c.verified)).toBe(true);
      const none = await searchAuthorities(
        tx,
        actor,
        { query: 'zzzz qqqq xxxx', answer: true },
        deps(),
      );
      expect(none.hits).toEqual([]);
      expect(none.answer).toEqual({ claims: [], noAuthority: true });
    });
  });
});
