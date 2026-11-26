import {
  createEmbedGateway,
  createMockEmbedProvider,
  createMockRerankProvider,
  createRerankGateway,
} from '@causedeck/ai';
import type { Queryable } from '@causedeck/db';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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
import { drizzleRetriever, lexicalQueryText, planFilters } from './retrieve.ts';
import { searchCorpus, searchCorpusWithPlan, type SearchDeps } from './search.ts';
import {
  citableReference,
  courtLabel,
  type FusedCandidate,
  type SegmentCandidate,
  type SegmentRetriever,
} from './types.ts';

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

  it('a bench range narrows by the number of justices; no bench fields add no filter (#1174)', () => {
    const render = (filters: ReturnType<typeof planFilters>) =>
      new PgDialect().sqlToQuery(sql.join(filters, sql` and `));
    const base = heuristicPlan('x');
    expect(base).toMatchObject({ benchMin: null, benchMax: null });
    const legacy: typeof base = { ...base };
    delete legacy.benchMin;
    delete legacy.benchMax;
    expect(planFilters(legacy)).toHaveLength(2);
    const ranged = render(planFilters({ ...base, benchMin: 3, benchMax: 5 }));
    expect(ranged.sql).toContain('cardinality(j.bench) >= $1');
    expect(ranged.sql).toContain('cardinality(j.bench) between 1 and $2');
    expect(ranged.params).toEqual([3, 5]);
    expect(planFilters({ ...base, benchMin: 2 })).toHaveLength(3);
    expect(planFilters({ ...base, benchMax: 1 })).toHaveLength(3);
  });

  const BAIL =
    'What does a court weigh when granting regular bail, and what did the Supreme Court say about delay in trial?';

  it('drops question words from a natural-language question and keeps the legal words (#1182)', () => {
    const terms = searchTerms(BAIL);
    for (const word of ['what', 'does', 'did', 'say', 'court', 'about'])
      expect(terms).not.toContain(word);
    expect(terms).toEqual(
      expect.arrayContaining(['weigh', 'granting', 'regular', 'bail', 'delay', 'trial']),
    );
    // Legal words are never stop words.
    expect(searchTerms('should the regular bail be refused for delay in trial')).toEqual([
      'regular',
      'bail',
      'refused',
      'delay',
      'trial',
    ]);
  });

  it('ORs the lexical terms, never ANDs every word of the sentence (#1182)', () => {
    const text = lexicalQueryText(heuristicPlan(BAIL));
    expect(text).toContain(' | ');
    expect(text).not.toContain('&');
    for (const word of ['bail', 'delay', 'trial', 'regular']) expect(text.split(' | ')).toContain(word);
    expect(text.split(' | ')).not.toContain('what');
    expect(lexicalQueryText({ query: 'what does it say', keywords: [] })).toBe('');
  });

  it('a subject facet keeps untagged judgments and excludes ones tagged with another subject (#1182)', () => {
    const plan = { ...heuristicPlan('x'), subjectAreas: ['bail' as const] };
    const filters = planFilters(plan);
    expect(filters).toHaveLength(3);
    const [, , facet] = filters;
    if (facet === undefined) throw new Error('no subject facet');
    const subject = new PgDialect().sqlToQuery(facet).sql.replace(/\s+/g, ' ');
    expect(subject).toContain('t.subject_area in ($1)');
    expect(subject).toContain('or not exists (select 1 from judgment_tag t2 where t2.judgment_id = j.id)');
  });
});

describe('fusion', () => {
  it('needs no vector hit: a lexical arm with an empty vector arm keeps its rank order (#1182)', () => {
    const lexical = [candidate('s1', 'J1'), candidate('s2', 'J2'), candidate('s3', 'J3')];
    const fused = fuseArms([lexical, []]);
    expect(fused.map((c) => c.segmentId)).toEqual(['s1', 's2', 's3']);
  });

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

  it('carries bench strength onto the hit, null when the retriever had none (#1174)', () => {
    const hits = groupByJudgment([
      { ...candidate('a', 'J1', 'x', { benchStrength: 3 }), fusedScore: 1, rerankScore: null },
      { ...candidate('b', 'J2'), fusedScore: 0.5, rerankScore: null },
    ]);
    expect(hits.map((h) => h.benchStrength)).toEqual([3, null]);
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
    expect(result.counts).toMatchObject({ vector: 3, reranked: true, mode: 'hybrid' });
    expect(result.answer).toBeNull();
  });

  it('lexical-only skips the embed call and the vector arm and ranks the lexical arm alone (#1182)', async () => {
    const vector = vi.fn(() => Promise.resolve([...corpus]));
    const lexicalOnlyRetriever: SegmentRetriever = {
      lexical: (plan, limit) => retriever.lexical(plan, limit),
      vector,
    };
    const embed = { embed: vi.fn(() => Promise.reject(new Error('no embedding'))) };
    const result = await searchCorpus(
      deps({ retriever: lexicalOnlyRetriever, embed, lexicalOnly: true }),
      'surgery consent infection',
    );
    expect(vector).not.toHaveBeenCalled();
    expect(embed.embed).not.toHaveBeenCalled();
    expect(result.counts).toMatchObject({ vector: 0, mode: 'lexical-only' });
    expect(result.counts.lexical).toBeGreaterThan(0);
    expect(result.hits.map((h) => h.judgmentId)).toEqual(['J1']);
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

  it('accepts a stored plan without bench fields and checks a bench range (#1174)', () => {
    const legacy: ReturnType<typeof heuristicPlan> = heuristicPlan('bail');
    delete legacy.benchMin;
    delete legacy.benchMax;
    expect(validatePlan(legacy)).toMatchObject({ benchMin: null, benchMax: null });
    const plan = heuristicPlan('bail');
    expect(validatePlan({ ...plan, benchMin: 3, benchMax: 5 })).toMatchObject({
      benchMin: 3,
      benchMax: 5,
    });
    expect(validatePlan({ ...plan, benchMin: 5, benchMax: 3 })).toBeNull();
    expect(validatePlan({ ...plan, benchMin: 0 })).toBeNull();
    expect(validatePlan({ ...plan, benchMax: 16 })).toBeNull();
    expect(validatePlan({ ...plan, benchMin: 2.5 })).toBeNull();
  });

  it('canonicalises statutes the advocate typed', () => {
    const plan = { ...heuristicPlan('x'), statutes: [{ statute: 'IPC', section: '304A' }] };
    expect(validatePlan(plan)?.statutes).toEqual([
      { statute: 'indian penal code', section: '304a' },
    ]);
  });
});

describe('citable reference (#1189)', () => {
  it('selects case_numbers with the judgment fields', async () => {
    const statements: SQL[] = [];
    const db = {
      execute: (statement: SQL) => {
        statements.push(statement);
        return Promise.resolve([]);
      },
    } as unknown as Queryable;
    await drizzleRetriever(db, { embeddingModel: 'm' }).lexical(heuristicPlan('bail'), 5);
    const text = new PgDialect().sqlToQuery(statements[0] as SQL).sql.replace(/\s+/g, ' ');
    expect(text).toContain('j.case_numbers as "caseNumbers"');
    expect(text).toContain('j.neutral_citation as "neutralCitation"');
  });

  it('carries case numbers from the candidates onto the hits', () => {
    const hits = groupByJudgment(
      fuseArms([
        [
          candidate('s1', 'j1', 'a', { caseNumbers: ['C.A. 1 of 2008', '[2008] 9 SCR 821'] }),
          candidate('s2', 'j2', 'b'),
        ],
      ]),
    );
    expect(hits.map((h) => h.caseNumbers)).toEqual([['C.A. 1 of 2008', '[2008] 9 SCR 821'], []]);
  });

  it('prefers the neutral citation, then the SCR citation, then nothing', () => {
    expect(citableReference('2023:INSC:12', ['[2023] 1 SCR 5'])).toBe('2023:INSC:12');
    expect(citableReference(null, ['C.A. 1 of 2008', '[2008] 9 SCR 821'])).toBe('[2008] 9 SCR 821');
    expect(citableReference('', ['[2008] 9 SCR 821'])).toBe('[2008] 9 SCR 821');
    expect(citableReference(null, ['C.A. 1 of 2008'])).toBeNull();
    expect(citableReference(null, ['[2008] 9 SCR'])).toBeNull();
    expect(citableReference(null, [])).toBeNull();
    expect(citableReference(null, undefined)).toBeNull();
  });

  it('labels the Supreme Court and shows other courts as stored', () => {
    expect(courtLabel('INSC')).toBe('Supreme Court of India');
    expect(courtLabel('MHC')).toBe('MHC');
    expect(courtLabel('')).toBeNull();
    expect(courtLabel(null)).toBeNull();
  });
});
