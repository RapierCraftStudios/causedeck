import {
  createEmbedGateway,
  createMockEmbedProvider,
  createMockRerankProvider,
  createRerankGateway,
} from '@causedeck/ai';
import { describe, expect, it, vi } from 'vitest';

import { answerQuery } from './answer.ts';
import {
  candidateBoost,
  fuseArms,
  groupByJudgment,
  rerankCandidates,
  RESULT_JUDGMENTS,
} from './fuse.ts';
import {
  expandedStatutes,
  heuristicPlan,
  normalisePlan,
  planQuery,
  searchTerms,
  validatePlan,
  statuteChips,
} from './plan.ts';
import { planFilters } from './retrieve.ts';
import { searchCorpus, searchCorpusWithPlan, type SearchDeps } from './search.ts';
import type { FusedCandidate, SegmentCandidate, SegmentRetriever } from './types.ts';

const candidate = (
  id: string,
  judgmentId: string,
  text = `text of ${id}`,
  extra = {},
): SegmentCandidate => ({
  segmentId: id,
  judgmentId,
  judgmentYear: 2020,
  ordinal: 1,
  role: 'reasoning',
  pageFrom: 1,
  pageTo: 1,
  text,
  court: 'MHC',
  courtLevel: 'high_court',
  title: `Title ${judgmentId}`,
  titleMasked: false,
  neutralCitation: null,
  judgmentDate: '2020-01-01',
  outcome: 'unknown',
  citedByCount: 0,
  sourceUrl: 'https://court.example/j.pdf',
  ...extra,
});

describe('plan', () => {
  it('reads statutes in either order and the IPC/BNS counterpart is part of the facet', () => {
    const plan = heuristicPlan(
      'negligent death, BNS 106 and section 304A of the IPC, s.37 NDPS bail',
    );
    const keys = plan.statutes.map((s) => `${s.statute}|${s.section}`);
    expect(keys).toContain('bharatiya nyaya sanhita|106');
    expect(keys).toContain('indian penal code|304a');
    expect(keys).toContain('narcotic drugs and psychotropic substances act|37');
    const expanded = expandedStatutes(heuristicPlan('BNS 106')).map(
      (s) => `${s.statute}|${s.section}`,
    );
    expect(expanded).toContain('indian penal code|304a');
    const chip = statuteChips({ ...heuristicPlan('IPC 304A'), offenceDate: '2022-05-01' })[0];
    expect(chip?.counterparts[0]).toMatchObject({
      statute: 'bharatiya nyaya sanhita',
      section: '106',
      inForce: false,
    });
  });

  it('finds subject areas and a court level from the words', () => {
    const plan = heuristicPlan('medical negligence, post-operative infection, Supreme Court');
    expect(plan.subjectAreas).toContain('medical_negligence');
    expect(plan.courtLevel).toBe('supreme_court');
    expect(heuristicPlan('hello').subjectAreas).toEqual([]);
  });

  it('drops anything outside the vocabularies and keeps the advocate words', () => {
    const plan = normalisePlan('surgery without consent and infection afterwards', {
      factDescription: 'x',
      keywords: ['Infection', 'a'],
      subjectAreas: ['medical_negligence', 'made_up_area'],
      statutes: [
        { statute: 'IPC', section: '304A' },
        { statute: '', section: '1' },
      ],
      courts: ['mhc', 'not a court!'],
      courtLevel: 'galactic',
      dateFrom: '2024-02-30',
      dateTo: '2020-01-01',
      outcome: 'won',
      offenceDate: '2022-13-01',
    });
    expect(plan.planner).toBe('gateway');
    expect(plan.factDescription).toBe('surgery without consent and infection afterwards');
    expect(plan.subjectAreas).toEqual(['medical_negligence']);
    expect(plan.statutes).toEqual([{ statute: 'indian penal code', section: '304a' }]);
    expect(plan.courts).toEqual(['MHC']);
    expect(plan.courtLevel).toBeNull();
    expect(plan.dateFrom).toBeNull();
    expect(plan.dateTo).toBe('2020-01-01');
    expect(plan.outcome).toBeNull();
    expect(plan.offenceDate).toBeNull();
  });

  it('an inverted date range is dropped and an unusable reply leaves the rules plan', () => {
    const inverted = normalisePlan('bail', { dateFrom: '2024-01-01', dateTo: '2020-01-01' });
    expect([inverted.dateFrom, inverted.dateTo]).toEqual([null, null]);
    expect(normalisePlan('bail', 42).planner).toBe('heuristic');
  });

  it('a failing planner leaves the rules plan; search terms drop function words', async () => {
    const plan = await planQuery('bail under NDPS', () => Promise.reject(new Error('budget')));
    expect(plan.planner).toBe('heuristic');
    expect(plan.subjectAreas).toContain('ndps');
    expect(searchTerms('The patient was not told of the risk')).toEqual([
      'patient',
      'told',
      'risk',
    ]);
  });

  it('turns every plan facet into a filter', () => {
    const plan = {
      ...heuristicPlan('x'),
      courts: ['MHC'],
      courtLevel: 'high_court' as const,
      dateFrom: '2010-01-01',
      dateTo: '2020-12-31',
      outcome: 'allowed' as const,
      subjectAreas: ['bail' as const],
      statutes: [{ statute: 'indian penal code', section: '304a' }],
    };
    // redaction and segment currency, court, level, two date pairs, outcome, subject, statute.
    expect(planFilters(plan)).toHaveLength(2 + 1 + 1 + 4 + 1 + 1 + 1);
    expect(planFilters(heuristicPlan('x'))).toHaveLength(2);
  });
});

describe('fusion', () => {
  it('merges the arms by reciprocal rank and a segment in both outranks one in a single arm', () => {
    const a = [candidate('s1', 'J1'), candidate('s2', 'J2')];
    const b = [candidate('s2', 'J2'), candidate('s3', 'J3')];
    const fused = fuseArms([a, b]);
    expect(fused.map((c) => c.segmentId)).toEqual(['s2', 's1', 's3']);
    expect(fused[0]?.fusedScore).toBeCloseTo(
      1 / 62 + 1 / 61 + candidateBoost(candidate('x', 'J')),
      6,
    );
  });

  it('boosts higher courts and cited judgments slightly, never past a rank position of the top', () => {
    const sc = candidateBoost({ courtLevel: 'supreme_court', citedByCount: 0 });
    const hc = candidateBoost({ courtLevel: 'high_court', citedByCount: 0 });
    const cited = candidateBoost({ courtLevel: 'other', citedByCount: 100 });
    expect(sc).toBeGreaterThan(hc);
    expect(cited).toBeGreaterThan(0);
    expect(candidateBoost({ courtLevel: 'other', citedByCount: 1e6 })).toBeLessThan(0.01);
    const fused = fuseArms([
      [
        candidate('a', 'J1', 'x', { courtLevel: 'other' }),
        candidate('b', 'J2', 'x', { courtLevel: 'supreme_court' }),
      ],
    ]);
    expect(fused[0]?.segmentId).toBe('b');
  });

  it('reranks the top, and a failing reranker leaves the fused order', async () => {
    const fused = fuseArms([
      [candidate('s1', 'J1', 'tax appeal'), candidate('s2', 'J2', 'surgery without consent')],
    ]);
    const gateway = createRerankGateway({ providers: [createMockRerankProvider()] });
    const out = await rerankCandidates('surgery consent', fused, gateway);
    expect(out.reranked).toBe(true);
    expect(out.candidates[0]?.segmentId).toBe('s2');
    const failed = await rerankCandidates('q', fused, {
      rerank: () => Promise.reject(new Error('down')),
    });
    expect(failed.reranked).toBe(false);
    expect(failed.candidates.map((c) => c.segmentId)).toEqual(['s1', 's2']);
  });

  it('groups by judgment: best three segments each, top 20 judgments', () => {
    const many: FusedCandidate[] = [];
    for (let j = 0; j < 25; j += 1) {
      for (let s = 0; s < 4; s += 1) {
        many.push({
          ...candidate(`s${String(j)}-${String(s)}`, `J${String(j)}`),
          fusedScore: 1 - (j * 4 + s) / 1000,
          rerankScore: null,
        });
      }
    }
    const hits = groupByJudgment(many);
    expect(hits).toHaveLength(RESULT_JUDGMENTS);
    expect(hits.every((h) => h.segments.length === 3)).toBe(true);
    expect(hits[0]?.judgmentId).toBe('J0');
  });
});

describe('answer', () => {
  const hit = groupByJudgment([
    {
      ...candidate('s1', 'J1', 'Surgery was done without informed consent.'),
      fusedScore: 1,
      rerankScore: null,
    },
  ]);

  it('marks a quote that is not in the segment unsupported, never verified', async () => {
    const answer = await answerQuery('consent', hit, () =>
      Promise.resolve({
        claims: [
          { statement: 'No consent', segmentId: 's1', quote: 'without informed consent' },
          { statement: 'Invented', segmentId: 's1', quote: 'the hospital paid Rs 5 lakh' },
          { statement: 'Not shown', segmentId: 's9', quote: 'without informed consent' },
        ],
      }),
    );
    expect(answer.claims.map((c) => c.verified)).toEqual([true, false, false]);
    expect(answer.claims[2]?.judgmentId).toBeNull();
    expect(answer.noAuthority).toBe(false);
  });

  it('no matching authority is a valid answer and costs no model call', async () => {
    const resolve = vi.fn();
    expect(await answerQuery('x', [], resolve)).toEqual({ claims: [], noAuthority: true });
    expect(resolve).not.toHaveBeenCalled();
    expect((await answerQuery('x', hit, () => Promise.resolve({ claims: [] }))).noAuthority).toBe(
      true,
    );
  });

  it('a reply that breaks the schema is an error, not an answer', async () => {
    await expect(answerQuery('x', hit, () => Promise.resolve({ nope: 1 }))).rejects.toThrow();
  });

  it('shows the model segment ids and text only', async () => {
    const resolve = vi.fn(() => Promise.resolve({ claims: [] }));
    await answerQuery('consent', hit, resolve);
    expect(resolve.mock.calls[0]).toEqual([
      {
        query: 'consent',
        segments: [{ id: 's1', text: 'Surgery was done without informed consent.' }],
      },
    ]);
  });
});

describe('search pipeline', () => {
  const corpus = [
    candidate('s1', 'J1', 'Surgery without informed consent led to a post-operative infection.'),
    candidate('s2', 'J2', 'Bail under NDPS for a commercial quantity.'),
    candidate('s3', 'J1', 'Compensation for negligence was awarded.'),
  ];
  const retriever: SegmentRetriever = {
    lexical: (plan) =>
      Promise.resolve(
        corpus.filter((c) => plan.keywords.some((k) => c.text.toLowerCase().includes(k))),
      ),
    vector: () => Promise.resolve([...corpus].reverse()),
  };
  const mock = createMockEmbedProvider();
  const deps = (over: Partial<SearchDeps> = {}): SearchDeps => ({
    retriever,
    embed: createEmbedGateway({ providers: [mock] }),
    rerank: createRerankGateway({ providers: [createMockRerankProvider()] }),
    ...over,
  });

  it('plans, retrieves, fuses, reranks and groups', async () => {
    const result = await searchCorpus(deps(), 'surgery without consent infection');
    expect(result.hits[0]?.judgmentId).toBe('J1');
    expect(result.hits[0]?.segments.length).toBeGreaterThan(0);
    expect(result.counts).toMatchObject({ vector: 3, reranked: true });
    expect(result.answer).toBeNull();
  });

  it('re-running with an edited plan never calls the planner', async () => {
    const plan = vi.fn(() => Promise.resolve({}));
    const first = await searchCorpus(deps({ plan }), 'surgery without consent');
    expect(plan).toHaveBeenCalledTimes(1);
    const lexical = vi.spyOn(retriever, 'lexical');
    const edited = { ...first.plan, courtLevel: 'supreme_court' as const };
    await searchCorpusWithPlan(deps({ plan }), edited);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(lexical).toHaveBeenCalledWith(edited, expect.any(Number));
  });

  it('keeps the hits when the answer model fails and marks the answer failed', async () => {
    const result = await searchCorpus(
      deps({ answer: () => Promise.reject(new Error('budget')) }),
      'surgery consent',
      { answer: true },
    );
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.answer).toBeNull();
    expect(result.answerFailed).toBe(true);
  });

  it('returns an empty hit list as no matching authority', async () => {
    const none: SegmentRetriever = {
      lexical: () => Promise.resolve([]),
      vector: () => Promise.resolve([]),
    };
    const result = await searchCorpus(
      deps({ retriever: none, answer: vi.fn() }),
      'anything at all',
      { answer: true },
    );
    expect(result.hits).toEqual([]);
    expect(result.answer).toEqual({ claims: [], noAuthority: true });
  });

  it('runs well inside the 2.5 s budget on the fixture (the staging p95 is measured after deploy)', async () => {
    const started = performance.now();
    for (let i = 0; i < 20; i += 1) await searchCorpus(deps(), 'surgery without consent infection');
    expect((performance.now() - started) / 20).toBeLessThan(250);
  });
});

describe('validatePlan', () => {
  it('keeps an edit exactly: a removed chip is not re-added by the rules', () => {
    const plan = { ...heuristicPlan('BNS 106 medical negligence'), statutes: [], subjectAreas: [] };
    expect(validatePlan(plan)).toMatchObject({ statutes: [], subjectAreas: [] });
  });

  it('refuses a plan outside the vocabularies or with a bad range', () => {
    const plan = heuristicPlan('bail');
    expect(validatePlan({ ...plan, subjectAreas: ['nonsense'] })).toBeNull();
    expect(validatePlan({ ...plan, dateFrom: '2024-02-30' })).toBeNull();
    expect(validatePlan({ ...plan, dateFrom: '2024-01-01', dateTo: '2020-01-01' })).toBeNull();
    expect(validatePlan({ ...plan, query: '' })).toBeNull();
    expect(validatePlan('x')).toBeNull();
  });

  it('canonicalises statutes the advocate typed', () => {
    const plan = { ...heuristicPlan('x'), statutes: [{ statute: 'IPC', section: '304A' }] };
    expect(validatePlan(plan)?.statutes).toEqual([
      { statute: 'indian penal code', section: '304a' },
    ]);
  });
});
