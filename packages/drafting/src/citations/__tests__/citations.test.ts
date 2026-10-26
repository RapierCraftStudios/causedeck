import { describe, expect, it, vi } from 'vitest';

import type { Block } from '../../blocks';
import {
  checkCitations,
  classify,
  createIndianKanoonResolver,
  createMockResolver,
  createRateLimiter,
  extractCitations,
  extractFromText,
  officialLink,
  titleSimilarity,
  type ResolverHit,
} from '../index';

import fixture from './fixtures/citations.json';

interface Case {
  id: string;
  label: 'valid' | 'fabricated' | 'near_miss';
  text: string;
  citation: string;
  expected: 'verified' | 'not_found' | 'unknown';
  reason?: string;
}
const authorities: ResolverHit[] = fixture.authorities.map((a) => ({
  citation: a.citation,
  title: a.title,
  sourceUrl: a.sourceUrl,
}));
const cases = fixture.cases as Case[];

describe('extraction', () => {
  it.each([
    ['the order in 2023 INSC 123 is', 'neutral', '2023 INSC 123'],
    ['see 2024:MHC:1234.', 'neutral', '2024:MHC:1234'],
    ['see 2024 : KHC : 5678.', 'neutral', '2024:KHC:5678'],
    ['reported at (2019) 5 SCC 123 and', 'reporter', '(2019) 5 SCC 123'],
    ['reported at 2019 SCC OnLine Mad 1234 and', 'reporter', '2019 SCC OnLine Mad 1234'],
    ['AIR 1999 SC 77 holds', 'reporter', 'AIR 1999 SC 77'],
    ['at (2010) 3 MLJ 45 it', 'reporter', '(2010) 3 MLJ 45'],
    ['at ILR 2001 Kar 55 it', 'reporter', 'ILR 2001 Kar 55'],
  ])('finds %s', (text, kind, normalized) => {
    const [item, ...rest] = extractFromText(text, 'b.0');
    expect(rest).toEqual([]);
    expect(item?.kind).toBe(kind);
    expect(item?.normalized).toBe(normalized);
    expect(text.slice(item?.span[0], item?.span[1])).toBe(item?.raw);
  });

  it('maps spans to block ids over the tree, and ignores slot text', () => {
    const blocks: Block[] = [
      { type: 'heading', id: 'h1', level: 1, text: 'Reliance on 2023 INSC 5' },
      {
        type: 'section',
        title: 'Law',
        children: [
          { type: 'paragraph', text: 'First.' },
          { type: 'paragraph', id: 'p9', text: 'Also AIR 2000 SC 1 and (2001) 2 SCC 3.' },
        ],
      },
    ];
    const items = extractCitations(blocks);
    expect(items.map((i) => [i.blockId, i.normalized])).toEqual([
      ['h1', '2023 INSC 5'],
      ['p9', 'AIR 2000 SC 1'],
      ['p9', '(2001) 2 SCC 3'],
    ]);
    expect(items[1]?.id).toBe('p9:5-18');
  });

  it('keeps a case name as the title hint of the citation after it', () => {
    const [item, ...rest] = extractFromText(
      'In Ramesh Kumar v. State of Kerala, 2023 INSC 123 the court held',
      'b',
    );
    expect(rest).toEqual([]);
    expect(item?.titleHint).toBe('Ramesh Kumar v. State of Kerala');
  });

  it('lists a bare case name as an unsupported item of its own', () => {
    const [item] = extractFromText('Ramesh Kumar v. State of Kerala was decided.', 'b');
    expect(item?.kind).toBe('case_name');
  });
});

describe('classification', () => {
  const hit: ResolverHit = {
    citation: '2023 INSC 1',
    title: 'Ramesh Kumar v. State of Kerala',
    sourceUrl: 'https://x.test/1',
  };
  const base = { normalized: '2023 INSC 1', titleHint: 'Ramesh Kumar v. State of Kerala' };

  it('verifies on an exact match and a close title', () => {
    expect(classify(base, { kind: 'hits', hits: [hit] }).status).toBe('verified');
  });
  it('is unknown below the title threshold and without a title', () => {
    expect(
      classify({ ...base, titleHint: 'Anitha Rao v. Union of India' }, { kind: 'hits', hits: [hit] }),
    ).toMatchObject({ status: 'unknown', reason: 'title_mismatch' });
    expect(classify({ normalized: base.normalized }, { kind: 'hits', hits: [hit] })).toMatchObject({
      status: 'unknown',
      reason: 'title_missing',
    });
  });
  it('honours a configured threshold', () => {
    const near = { ...base, titleHint: 'Ramesh Kumar v. State of Goa' };
    expect(classify(near, { kind: 'hits', hits: [hit] }).status).toBe('unknown');
    expect(classify(near, { kind: 'hits', hits: [hit] }, { titleThreshold: 0.4 }).status).toBe(
      'verified',
    );
  });
  it('is unknown when two different authorities carry the citation', () => {
    const other = { ...hit, sourceUrl: 'https://x.test/2' };
    expect(classify(base, { kind: 'hits', hits: [hit, other] })).toMatchObject({
      status: 'unknown',
      reason: 'ambiguous',
    });
  });
  it('is not_found with no exact hit, and unknown on outage or throttle', () => {
    expect(classify(base, { kind: 'hits', hits: [] }).status).toBe('not_found');
    expect(classify(base, { kind: 'hits', hits: [{ ...hit, citation: '2023 INSC 2' }] }).status).toBe(
      'not_found',
    );
    expect(classify(base, { kind: 'unavailable' })).toEqual({
      status: 'unknown',
      reason: 'resolver_unavailable',
    });
    expect(classify(base, { kind: 'throttled' })).toEqual({ status: 'unknown', reason: 'throttled' });
  });
  it('scores identical names 1 and unrelated names 0', () => {
    expect(titleSimilarity('A B v. C D', 'a b vs c d')).toBe(1);
    expect(titleSimilarity('A B v. C D', 'X Y v. Z W')).toBe(0);
  });
});

describe('labelled fixture set', () => {
  it('has at least 200 labelled cases of each kind of label', () => {
    expect(cases.length).toBeGreaterThanOrEqual(200);
    for (const label of ['valid', 'fabricated', 'near_miss']) {
      expect(cases.some((c) => c.label === label)).toBe(true);
    }
  });

  it('keeps the false-verified rate at or below 0.5% and never verifies a fabrication', async () => {
    const resolver = createMockResolver(authorities);
    let wrong = 0;
    let notValid = 0;
    for (const c of cases) {
      const extracted = extractFromText(c.text, 'b').filter((i) => i.kind !== 'case_name');
      expect(extracted, c.id).toHaveLength(1);
      expect(extracted[0]?.normalized, c.id).toBe(c.citation);
      const [checked] = await checkCitations(extracted, { resolver, workspaceId: 'w' });
      expect(checked?.verdict.status, c.id).toBe(c.expected);
      if (c.reason !== undefined) expect(checked?.verdict.reason, c.id).toBe(c.reason);
      if (c.label !== 'valid') {
        notValid += 1;
        if (checked?.verdict.status === 'verified') wrong += 1;
        if (c.label === 'fabricated') expect(checked?.verdict.status).not.toBe('verified');
      }
    }
    expect(notValid).toBeGreaterThan(100);
    expect(wrong / notValid).toBeLessThanOrEqual(0.005);
  });

  it('checks 10 citations against the mock resolver well under 5 s (p95)', async () => {
    const resolver = createMockResolver(authorities);
    const text = cases
      .filter((c) => c.label === 'valid')
      .slice(0, 10)
      .map((c) => c.text)
      .join(' ');
    const blocks: Block[] = [{ type: 'paragraph', text }];
    const times: number[] = [];
    for (let run = 0; run < 20; run += 1) {
      const t0 = performance.now();
      const extracted = extractCitations(blocks);
      await checkCitations(extracted, { resolver, workspaceId: 'w' });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(5000);
  });
});

describe('resolvers, limits and links', () => {
  const citation = {
    id: 'b:0-13',
    blockId: 'b',
    span: [0, 13] as [number, number],
    raw: '2023 INSC 123',
    normalized: '2023 INSC 123',
    kind: 'neutral' as const,
    titleHint: 'Ramesh Kumar v. State of Kerala',
  };

  it('runs the mock offline, with no network call', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const [checked] = await checkCitations([citation], {
      resolver: createMockResolver(),
      workspaceId: 'w',
    });
    expect(checked?.verdict.status).toBe('verified');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('leaves a citation unknown when the resolver is unavailable', async () => {
    const [checked] = await checkCitations([citation], {
      resolver: createMockResolver([], { unavailable: true }),
      workspaceId: 'w',
    });
    expect(checked?.verdict).toEqual({ status: 'unknown', reason: 'resolver_unavailable' });
  });

  it('retries the Indian Kanoon client with backoff, then reports unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('busy', { status: 503 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolver = createIndianKanoonResolver({
      token: 't',
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
      random: () => 0,
    });
    await expect(resolver.resolve({ normalized: '2023 INSC 123', kind: 'neutral' })).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([250, 500]);
  });

  it('keeps only citation, url and a short title from an Indian Kanoon answer', async () => {
    const body = {
      docs: [
        {
          tid: 42,
          title: 'Ramesh Kumar v. State of Kerala on 5 May, 2023',
          headline: 'long judgment text ... 2023 INSC 123 ... more judgment text',
        },
        { tid: 43, title: 'Other v. Case', headline: 'cites 2023 INSC 999 only' },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    const resolver = createIndianKanoonResolver({
      token: 't',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const outcome = await resolver.resolve({ normalized: '2023 INSC 123', kind: 'neutral' });
    expect(outcome).toEqual({
      kind: 'hits',
      hits: [
        {
          citation: '2023 INSC 123',
          title: 'Ramesh Kumar v. State of Kerala on 5 May, 2023',
          sourceUrl: 'https://indiankanoon.org/doc/42/',
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain('judgment text');
  });

  it('marks citations throttled past the daily budget or the rate limit', async () => {
    const external = { ...createMockResolver(), external: true };
    const two = [citation, { ...citation, id: 'b:20-33' }, { ...citation, id: 'b:40-53' }];
    const budgeted = await checkCitations(two, {
      resolver: external,
      workspaceId: 'w',
      budgetRemaining: 1,
    });
    expect(budgeted.map((c) => c.verdict.reason)).toEqual([undefined, 'throttled', 'throttled']);
    const clock = { t: 0 };
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => clock.t });
    const limited = await checkCitations(two, { resolver: external, workspaceId: 'w', limiter });
    expect(limited.map((c) => c.verdict.reason)).toEqual([undefined, 'throttled', 'throttled']);
    clock.t = 1000;
    expect(limiter.tryAcquire('w')).toBe(true);
    expect(limiter.tryAcquire('other')).toBe(true);
  });

  it('builds plain portal links for neutral citations only', () => {
    expect(officialLink('2023 INSC 1', 'neutral')?.url).toMatch(/^https:\/\//);
    expect(officialLink('2024:MHC:1', 'neutral')?.url).toMatch(/mhc/);
    expect(officialLink('2024:KHC:1', 'neutral')?.url).toMatch(/karnataka/);
    expect(officialLink('(2019) 5 SCC 1', 'reporter')).toBeNull();
  });
});
