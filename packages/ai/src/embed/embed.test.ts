import { describe, expect, it, vi } from 'vitest';

import { ProviderError, ResidencyViolationError } from '../errors.ts';
import { embedCostPaise } from '../pricing.ts';
import { createEmbedGateway } from './gateway.ts';
import {
  createBgem3Provider,
  createCohereEmbedProvider,
  createMockEmbedProvider,
  createTitanEmbedProvider,
} from './providers.ts';

const creds = {
  region: 'ap-south-1',
  accessKeyId: 'AKIATEST',
  secretAccessKey: 'secret',
  now: () => new Date('2026-10-31T00:00:00Z'),
};
const vec = (n: number) => new Array<number>(n).fill(0.5);
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('providers', () => {
  it('Cohere sends a batch to InvokeModel and reads embeddings', async () => {
    const fetch = vi.fn(() => Promise.resolve(ok({ embeddings: [vec(1024), vec(1024)] })));
    const p = createCohereEmbedProvider({ ...creds, fetch });
    const out = await p.embed(['a', 'b']);
    expect(out.vectors).toHaveLength(2);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(
      'bedrock-runtime.ap-south-1.amazonaws.com/model/cohere.embed-multilingual-v3/invoke',
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      texts: ['a', 'b'],
      input_type: 'search_document',
    });
    expect(p.dataResidency).toBe('in');
  });

  it('Titan embeds one text a call and sums reported tokens', async () => {
    const fetch = vi.fn(() => Promise.resolve(ok({ embedding: vec(512), inputTextTokenCount: 7 })));
    const p = createTitanEmbedProvider({ ...creds, dimensions: 512, fetch });
    const out = await p.embed(['a', 'b']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(out.inputTokens).toBe(14);
    expect(p.modelVersion).toBe('amazon.titan-embed-text-v2:0@512');
  });

  it('bge-m3 posts to /embed with a bearer token', async () => {
    const fetch = vi.fn(() => Promise.resolve(ok([vec(1024)])));
    const p = createBgem3Provider({
      baseUrl: 'https://bge.internal/',
      region: 'ap-south-2',
      token: 't',
      fetch,
    });
    await p.embed(['a']);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://bge.internal/embed');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t');
  });

  it('marks throttling retryable and malformed bodies as errors', async () => {
    const throttled = createCohereEmbedProvider({
      ...creds,
      fetch: () => Promise.resolve(new Response('', { status: 429 })),
    });
    await expect(throttled.embed(['a'])).rejects.toMatchObject({ retryable: true });
    const bad = createCohereEmbedProvider({ ...creds, fetch: () => Promise.resolve(ok({})) });
    await expect(bad.embed(['a'])).rejects.toBeInstanceOf(ProviderError);
  });

  it('the mock is deterministic, unit length and version-sensitive', async () => {
    const a = await createMockEmbedProvider().embed(['res ipsa loquitur']);
    const b = await createMockEmbedProvider().embed(['res ipsa loquitur']);
    expect(a.vectors).toEqual(b.vectors);
    expect(Math.hypot(...(a.vectors[0] ?? []))).toBeCloseTo(1);
    expect(createMockEmbedProvider({ version: '2' }).modelVersion).not.toBe(
      createMockEmbedProvider().modelVersion,
    );
  });
});

describe('gateway', () => {
  it('refuses a provider outside India before sending any text', async () => {
    const fetch = vi.fn();
    const p = createBgem3Provider({ baseUrl: 'https://x', region: 'us-east-1', fetch });
    const gw = createEmbedGateway({ providers: [p] });
    await expect(gw.embed(['secret text'])).rejects.toBeInstanceOf(ResidencyViolationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows a non-India provider only when India-only is off', async () => {
    const fetch = vi.fn(() => Promise.resolve(ok([vec(1024)])));
    const p = createBgem3Provider({ baseUrl: 'https://x', region: 'us-east-1', fetch });
    const out = await createEmbedGateway({ providers: [p], indiaOnly: false }).embed(['a']);
    expect(out.vectors).toHaveLength(1);
  });

  it('rejects a vector of the wrong width', async () => {
    const p = createBgem3Provider({
      baseUrl: 'https://x',
      region: 'ap-south-1',
      fetch: () => Promise.resolve(ok([vec(10)])),
    });
    await expect(createEmbedGateway({ providers: [p] }).embed(['a'])).rejects.toMatchObject({
      code: 'EMBED_WIDTH',
    });
  });

  it('meters cost in paise and retries a throttled call', async () => {
    let calls = 0;
    const p = createCohereEmbedProvider({
      ...creds,
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1 ? new Response('', { status: 429 }) : ok({ embeddings: [vec(1024)] }),
        );
      },
    });
    const gw = createEmbedGateway({ providers: [p], retry: { sleep: () => Promise.resolve() } });
    const out = await gw.embed(['x'.repeat(4_000_000)]);
    expect(calls).toBe(2);
    expect(out.inputTokens).toBe(1_000_000);
    expect(out.costPaise).toBe(840);
    expect(embedCostPaise('amazon.titan-embed-text-v2:0', 1_000_000)).toBe(168);
    expect(embedCostPaise('unknown', 1_000_000)).toBe(0);
  });
});
