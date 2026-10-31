// `system.corpus.enrich` (#894): facets are built from `redacted_text` and the decision segment, an
// IPC 304A judgment is found by the BNS 106 facet, citations resolve to corpus rows, the outcome is
// anchored or `unknown`, a second run is a no-op, and a run at a new version replaces only the rows
// of its own version.
import { randomUUID } from 'node:crypto';

import { schema, type Queryable } from '@causedeck/db';
import { closeTestDb, withTestDb } from '@causedeck/db/testing';
import { ENRICH_VERSION, matchesStatuteFacet, rulesetVersion } from '@causedeck/intelligence';
import { asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { runCorpusEnrich } from './corpus-enrich.ts';
import { runCorpusSegment } from './corpus-segment.ts';

afterAll(async () => {
  await closeTestDb();
});

const ctx = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as never;

const REDACTED = [
  {
    pageNo: 1,
    text: 'IN THE HIGH COURT OF MADRAS\nthe Appellant versus the Respondent\n\n1. The Appellant was charged under Section 304A of the Indian Penal Code after the surgery.',
  },
  {
    pageNo: 2,
    text: '2. The test in AIR 2010 SC 1234 and 2020:MHC:99 is met. We follow (2005) 6 SCC 1.\n\n3. In the result, the appeal is dismissed.',
  },
];

async function insert(
  db: Queryable,
  opts: { neutral?: string; pages?: typeof REDACTED } = {},
): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await db
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      neutralCitation: opts.neutral ?? null,
      judgmentDate: '2019-03-04',
      provenance: {
        url: 'https://mhc.example/j/e.pdf',
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [{ pageNo: 1, text: 'RAW TEXT WITH Ramesh Kumar' }],
      redactedText: opts.pages ?? REDACTED,
      redactionVersion: 1,
    })
    .returning({ id: schema.judgment.id });
  return row?.id ?? '';
}

const statutesOf = (db: Queryable, id: string) =>
  db.select().from(schema.judgmentStatuteRef).where(eq(schema.judgmentStatuteRef.judgmentId, id));
const citationsOf = (db: Queryable, id: string) =>
  db
    .select()
    .from(schema.judgmentCitationRef)
    .where(eq(schema.judgmentCitationRef.judgmentId, id))
    .orderBy(asc(schema.judgmentCitationRef.normalisedCitation));
const judgmentOf = async (db: Queryable, id: string) =>
  (await db.select().from(schema.judgment).where(eq(schema.judgment.id, id)))[0];

describe('runCorpusEnrich', () => {
  it('builds statute, citation and outcome facets and is idempotent', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never as Queryable;
      const cited = await insert(db, { neutral: '2020:MHC:99' });
      const id = await insert(db);
      await runCorpusSegment(ctx, { batch: 500 }, { db });
      const report = await runCorpusEnrich(ctx, { batch: 500 }, { db });
      expect(report.enriched).toBeGreaterThanOrEqual(2);

      const statutes = await statutesOf(db, id);
      expect(statutes).toContainEqual(
        expect.objectContaining({ statute: 'indian penal code', section: '304a', page: 1 }),
      );
      expect(statutes.every((s) => s.rulesetVersion === rulesetVersion())).toBe(true);
      expect(matchesStatuteFacet(statutes, { statute: 'BNS', section: '106' })).toBe(true);

      const citations = await citationsOf(db, id);
      expect(citations.map((c) => c.normalisedCitation)).toEqual([
        '(2005) 6 SCC 1',
        '2020:MHC:99',
        'AIR 2010 SC 1234',
      ]);
      const resolved = citations.find((c) => c.normalisedCitation === '2020:MHC:99');
      expect(resolved?.citedJudgmentId).toBe(cited);
      expect(citations.find((c) => c.normalisedCitation === 'AIR 2010 SC 1234')?.citedJudgmentId).toBeNull();

      const j = await judgmentOf(db, id);
      expect(j?.outcome).toBe('dismissed');
      expect(j?.outcomeAnchor).toEqual({ page: 2, quote: '3. In the result, the appeal is dismissed.' });
      expect(j?.courtLevel).toBe('high_court');
      expect(j?.enrichVersion).toBe(ENRICH_VERSION);
      expect(j?.enrichedRedactionVersion).toBe(1);

      const again = await runCorpusEnrich(ctx, { batch: 500 }, { db });
      expect(again.enriched).toBe(0);
      expect((await statutesOf(db, id)).length).toBe(statutes.length);
    });
  });

  it('sets the outcome to unknown, with no anchor, when the decision says nothing', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never as Queryable;
      const id = await insert(db, {
        pages: [{ pageNo: 1, text: '1. The Appellant filed a complaint.\n\n2. We have heard counsel.' }],
      });
      await runCorpusSegment(ctx, { batch: 500 }, { db });
      await runCorpusEnrich(ctx, { batch: 500 }, { db });
      const j = await judgmentOf(db, id);
      expect(j?.outcome).toBe('unknown');
      expect(j?.outcomeAnchor).toBeNull();
    });
  });

  it('leaves unsegmented judgments alone', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never as Queryable;
      const id = await insert(db);
      await runCorpusEnrich(ctx, { batch: 500 }, { db });
      expect((await judgmentOf(db, id))?.enrichVersion).toBe(0);
      expect(await statutesOf(db, id)).toEqual([]);
    });
  });

  it('replaces only the rows of the version it runs', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never as Queryable;
      const id = await insert(db);
      await runCorpusSegment(ctx, { batch: 500 }, { db });
      await runCorpusEnrich(ctx, { batch: 500 }, { db, version: 1 });
      const v1 = await statutesOf(db, id);
      expect(v1.length).toBeGreaterThan(0);
      // Tamper with the v1 row: a v2 run must not touch it.
      await db
        .update(schema.judgmentStatuteRef)
        .set({ page: 2 })
        .where(eq(schema.judgmentStatuteRef.judgmentId, id));

      const report = await runCorpusEnrich(ctx, { batch: 500 }, { db, version: 2 });
      expect(report.enriched).toBe(1);
      const all = await statutesOf(db, id);
      expect(all.filter((s) => s.rulesetVersion === rulesetVersion(1))).toHaveLength(v1.length);
      expect(all.filter((s) => s.rulesetVersion === rulesetVersion(1)).every((s) => s.page === 2)).toBe(true);
      expect(all.filter((s) => s.rulesetVersion === rulesetVersion(2))).toHaveLength(v1.length);
      expect((await judgmentOf(db, id))?.enrichVersion).toBe(2);

      // Re-running v2 replaces v2's rows (one copy each, no duplicates) and leaves v1.
      await db.update(schema.judgment).set({ enrichVersion: 1 }).where(eq(schema.judgment.id, id));
      await runCorpusEnrich(ctx, { batch: 500 }, { db, version: 2 });
      expect((await statutesOf(db, id)).length).toBe(v1.length * 2);
    });
  });

  it('stores validated subject tags under the resolver version, and none for an invalid reply', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never as Queryable;
      const id = await insert(db);
      await runCorpusSegment(ctx, { batch: 500 }, { db });
      const bad = { version: 'm-1', classify: async () => ({ nope: true }) };
      await runCorpusEnrich(ctx, { batch: 500 }, { db, resolver: bad, version: 1 });
      expect(await db.select().from(schema.judgmentTag).where(eq(schema.judgmentTag.judgmentId, id))).toEqual([]);

      const good = {
        version: 'm-1',
        classify: async () => ({ tags: [{ area: 'medical_negligence', confidence: 0.9 }, { area: 'made_up', confidence: 0.9 }] }),
      };
      await runCorpusEnrich(ctx, { batch: 500 }, { db, resolver: good, version: 2 });
      const tags = await db.select().from(schema.judgmentTag).where(eq(schema.judgmentTag.judgmentId, id));
      expect(tags).toEqual([
        expect.objectContaining({ subjectArea: 'medical_negligence', modelVersion: 'm-1', confidence: 0.9 }),
      ]);
    });
  });
});
