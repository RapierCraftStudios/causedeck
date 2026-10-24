// Block signatures and the optional health port (#515, D-049).
import { describe, expect, it, vi } from 'vitest';

import {
  createFetcher,
  detectBlockSignature,
  FetchDenied,
  postWebhook,
  type FetchPolicy,
  type FetchProvider,
} from '../index.ts';

const POLICY: FetchPolicy = {
  sourceId: 'in.nclt.bengaluru',
  kind: 'court',
  baseUrl: 'https://nclt.gov.in',
  rateLimitPerMinute: 5,
  maxTier: 'proxy',
  maxCostDollars: 0.02,
  captchaBulkCleared: false,
  version: 'v1',
};
const NOW = new Date('2026-10-23T12:00:00Z');

function build(
  response: { status: number; body: string },
  health?: Parameters<typeof createFetcher>[0]['health'],
) {
  const fetch = vi.fn(() =>
    Promise.resolve({
      ...response,
      contentType: 'text/html',
      tierUsed: 'http' as const,
      costDollars: 0,
    }),
  );
  const provider: FetchProvider = { fetch };
  const fetcher = createFetcher({
    registry: { policyFor: () => Promise.resolve(POLICY) },
    alterlab: provider,
    clock: { now: () => NOW },
    usage: { record: () => Promise.resolve() },
    log: { record: () => Promise.resolve() },
    ...(health === undefined ? {} : { health }),
  });
  return { fetcher, fetch };
}

describe('detectBlockSignature', () => {
  it('flags 403, 429 and challenge pages, not ordinary pages', () => {
    expect(detectBlockSignature(403, '')).toBe('http_403');
    expect(detectBlockSignature(429, '')).toBe('http_429');
    expect(detectBlockSignature(200, '<title>Just a moment...</title>')).toBe('challenge_page');
    expect(detectBlockSignature(200, '<html>cause list</html>')).toBeNull();
    expect(detectBlockSignature(200, 'Just a moment', 'application/json')).toBeNull();
  });
});

describe('fetcher health port', () => {
  it('refuses a backed-off source before any network call', async () => {
    const { fetcher, fetch } = build(
      { status: 200, body: 'ok' },
      { backoffUntil: () => Promise.resolve(new Date(NOW.getTime() + 60_000)) },
    );
    await expect(
      fetcher.fetchSource(POLICY.sourceId, 'https://nclt.gov.in/x'),
    ).rejects.toMatchObject({
      reason: 'source_backed_off',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches once the backoff has passed', async () => {
    const { fetcher } = build(
      { status: 200, body: 'ok' },
      { backoffUntil: () => Promise.resolve(new Date(NOW.getTime() - 1)) },
    );
    await expect(
      fetcher.fetchSource(POLICY.sourceId, 'https://nclt.gov.in/x'),
    ).resolves.toMatchObject({
      status: 200,
    });
  });

  it('reports a block signature, and a failing report never fails the fetch', async () => {
    const reportBlock = vi.fn(() => Promise.reject(new Error('down')));
    const { fetcher } = build(
      { status: 429, body: '' },
      { backoffUntil: () => Promise.resolve(null), reportBlock },
    );
    await expect(
      fetcher.fetchSource(POLICY.sourceId, 'https://nclt.gov.in/x'),
    ).resolves.toMatchObject({
      status: 429,
    });
    expect(reportBlock).toHaveBeenCalledWith({
      sourceId: POLICY.sourceId,
      signature: 'http_429',
      at: NOW,
    });
  });

  it('works without a health port', async () => {
    const { fetcher } = build({ status: 200, body: 'ok' });
    await expect(
      fetcher.fetchSource(POLICY.sourceId, 'https://nclt.gov.in/x'),
    ).resolves.toBeDefined();
  });
});

describe('postWebhook', () => {
  it('posts to Slack hosts only', async () => {
    const impl = vi.fn(() => Promise.resolve(new Response('ok')));
    await postWebhook('https://hooks.slack.com/services/T/B/x', { text: 'hi' }, impl);
    expect(impl).toHaveBeenCalledTimes(1);
    await expect(
      postWebhook('https://evil.example/x', { text: 'hi' }, impl as never),
    ).rejects.toBeInstanceOf(FetchDenied);
    await expect(
      postWebhook('http://hooks.slack.com/x', { text: 'hi' }, impl as never),
    ).rejects.toBeInstanceOf(FetchDenied);
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
