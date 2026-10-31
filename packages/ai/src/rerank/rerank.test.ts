import { describe, expect, it, vi } from 'vitest';

import { ProviderError, ResidencyViolationError } from '../errors.ts';
import { rerankCostPaise } from '../pricing.ts';
import { createRerankGateway } from './gateway.ts';
import {
  createBgeRerankProvider,
  createCohereRerankProvider,
  createMockRerankProvider,
} from './providers.ts';

const creds = {
  region: 'ap-south-1',
  accessKeyId: 'AKIATEST',
  secretAccessKey: 'secret',
  now: () => new Date('2026-10-31T00:00:00Z'),
};
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('providers', () => {
  it('Cohere posts the documents to InvokeModel and returns scores in document order', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        ok({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.1 },
          ],
        }),
      ),
    );
    const p = createCohereRerankProvider({ ...creds, fetch });
    const out = await p.rerank('q', ['a', 'b']);
    expect(out).toEqual({ scores: [0.1, 0.9], searches: 1 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/model/cohere.rerank-v3-5%3A0/invoke');
    expect(JSON.parse(init.body as string)).toMatchObject({ query: 'q', documents: ['a', 'b'] });
    expect(p.dataResidency).toBe('in');
  });

  it('bills a Cohere search per 100 documents', async () => {
    const docs = Array.from({ length: 101 }, (_, i) => `d${String(i)}`);
    const fetch = vi.fn(() =>
      Promise.resolve(ok({ results: docs.map((_, index) => ({ index, relevance_score: 0.5 })) })),
    );
    const out = await createCohereRerankProvider({ ...creds, fetch }).rerank('q', docs);
    expect(out.searches).toBe(2);
  });

  it('bge-reranker posts to /rerank with a bearer token', async () => {
    const fetch = vi.fn(() => Promise.resolve(ok([{ index: 0, score: 2 }])));
    const p = createBgeRerankProvider({
      baseUrl: 'https://bge.internal/',
      region: 'ap-south-2',
      token: 't',
      fetch,
    });
    const out = await p.rerank('q', ['a']);
    expect(out).toEqual({ scores: [2], searches: 0 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://bge.internal/rerank');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t');
  });

  it('rejects malformed bodies and marks throttling retryable', async () => {
    const bad = createCohereRerankProvider({ ...creds, fetch: () => Promise.resolve(ok({})) });
    await expect(bad.rerank('q', ['a'])).rejects.toBeInstanceOf(ProviderError);
    const partial = createCohereRerankProvider({
      ...creds,
      fetch: () => Promise.resolve(ok({ results: [{ index: 0, relevance_score: 1 }] })),
    });
    await expect(partial.rerank('q', ['a', 'b'])).rejects.toBeInstanceOf(ProviderError);
    const throttled = createCohereRerankProvider({
      ...creds,
      fetch: () => Promise.resolve(new Response('', { status: 429 })),
    });
    await expect(throttled.rerank('q', ['a'])).rejects.toMatchObject({ retryable: true });
  });

  it('the mock ranks the document sharing the query words first, deterministically', async () => {
    const p = createMockRerankProvider();
    const docs = ['unrelated tax appeal', 'surgery without informed consent of the patient'];
    const a = await p.rerank('surgery without consent', docs);
    const b = await p.rerank('surgery without consent', docs);
    expect(a).toEqual(b);
    expect(a.scores[1]).toBeGreaterThan(a.scores[0] ?? 1);
  });
});

describe('gateway', () => {
  it('refuses a non-India provider before sending any text', async () => {
    const send = vi.fn();
    const provider = {
      ...createMockRerankProvider(),
      dataResidency: 'other' as const,
      rerank: send,
    };
    const gateway = createRerankGateway({ providers: [provider] });
    await expect(gateway.rerank('q', ['a'])).rejects.toBeInstanceOf(ResidencyViolationError);
    expect(send).not.toHaveBeenCalled();
    const allowed = createRerankGateway({ providers: [provider], indiaOnly: false });
    expect(allowed.active()).toBe(provider);
  });

  it('checks the score count and meters the cost', async () => {
    const wrong = {
      ...createMockRerankProvider(),
      rerank: () => Promise.resolve({ scores: [1], searches: 1 }),
    };
    await expect(
      createRerankGateway({ providers: [wrong] }).rerank('q', ['a', 'b']),
    ).rejects.toBeInstanceOf(ProviderError);
    const priced = {
      ...createMockRerankProvider(),
      model: 'cohere.rerank-v3-5:0',
      rerank: () => Promise.resolve({ scores: [1], searches: 1 }),
    };
    const out = await createRerankGateway({ providers: [priced] }).rerank('q', ['a']);
    expect(out.costPaise).toBe(rerankCostPaise('cohere.rerank-v3-5:0', 1));
    expect(out.costPaise).toBe(17);
  });

  it('returns nothing for no documents without calling the provider', async () => {
    const send = vi.fn();
    const out = await createRerankGateway({
      providers: [{ ...createMockRerankProvider(), rerank: send }],
    }).rerank('q', []);
    expect(out.scores).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
