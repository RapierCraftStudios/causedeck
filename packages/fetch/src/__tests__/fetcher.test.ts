import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createFetcher,
  createMockProvider,
  createProvider,
  FetchDenied,
  FetchError,
  type FetchLogEntry,
  type FetchPolicy,
  type FetchProvider,
  type ProviderRequest,
  type ProviderResponse,
} from '../index.ts';

class NotCleared extends Error {}

const COURT: FetchPolicy = {
  sourceId: 'in.nclt.bengaluru',
  kind: 'court',
  baseUrl: 'https://nclt.gov.in',
  rateLimitPerMinute: 5,
  maxTier: 'proxy',
  maxCostDollars: 0.02,
  captchaBulkCleared: false,
  version: '2026-10-23T00:00:00.000Z',
};
const URL_OK = 'https://nclt.gov.in/cause-list';

function setup(
  policy: Partial<FetchPolicy> | 'denied' = {},
  response: Partial<ProviderResponse> = {},
  extra: { delegatedCaptchaPerHour?: number; hostRequestsPerMinute?: number } = {},
) {
  const requests: ProviderRequest[] = [];
  const logs: FetchLogEntry[] = [];
  const usage: { sourceId: string; costDollars: number }[] = [];
  const provider: FetchProvider = {
    fetch(request) {
      requests.push(request);
      return Promise.resolve({
        status: 200,
        body: '<html>list</html>',
        contentType: 'text/html',
        tierUsed: 'http',
        costDollars: 0.001,
        ...response,
      });
    },
  };
  let nowMs = Date.parse('2026-10-23T10:00:00Z');
  const policyFor = vi.fn((sourceId: string) =>
    policy === 'denied'
      ? Promise.reject(new NotCleared(`not cleared: ${sourceId}`))
      : Promise.resolve({ ...COURT, ...policy }),
  );
  const fetcher = createFetcher({
    registry: { policyFor },
    alterlab: provider,
    clock: { now: () => new Date(nowMs) },
    usage: {
      record: (event) => {
        usage.push(event);
        return Promise.resolve();
      },
    },
    log: {
      record: (entry) => {
        logs.push(entry);
        return Promise.resolve();
      },
    },
    ...extra,
  });
  return {
    fetcher,
    requests,
    logs,
    usage,
    policyFor,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe('fetchSource: registry first', () => {
  it('throws before any network call when the source is uncleared, unknown or killed', async () => {
    const { fetcher, requests, logs, usage } = setup('denied');

    await expect(fetcher.fetchSource('in.nclt.bengaluru', URL_OK)).rejects.toBeInstanceOf(
      NotCleared,
    );
    expect(requests).toEqual([]);
    expect(logs).toEqual([]);
    expect(usage).toEqual([]);
  });

  it('asks the registry on every call, so a kill switch takes effect at once', async () => {
    const { fetcher, policyFor } = setup();

    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);
    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);

    expect(policyFor).toHaveBeenCalledTimes(2);
  });

  it('refuses a URL outside the source and a non-web URL', async () => {
    const { fetcher, requests } = setup();

    await expect(
      fetcher.fetchSource('in.nclt.bengaluru', 'https://evil.example/x'),
    ).rejects.toMatchObject({ reason: 'url_outside_source' });
    await expect(
      fetcher.fetchSource('in.nclt.bengaluru', 'file:///etc/passwd'),
    ).rejects.toMatchObject({
      reason: 'invalid_url',
    });
    expect(requests).toEqual([]);
  });
});

describe('fetchSource: provider call and provenance', () => {
  it('passes India routing, fail-fast and the source caps through', async () => {
    const { fetcher, requests } = setup();

    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);

    expect(requests).toEqual([
      {
        url: URL_OK,
        maxTier: 'proxy',
        maxCostDollars: 0.02,
        proxyCountry: 'IN',
        failFast: true,
      },
    ]);
  });

  it('carries provenance with the sha256 of the body and records the cost per call', async () => {
    const { fetcher, logs, usage } = setup({}, { body: 'abc', costDollars: 0.004 });

    const result = await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);

    expect(result.provenance).toEqual({
      url: URL_OK,
      fetchedAt: '2026-10-23T10:00:00.000Z',
      sha256: createHash('sha256').update('abc').digest('hex'),
      sourceId: 'in.nclt.bengaluru',
      sourceVersion: COURT.version,
      tierUsed: 'http',
      costDollars: 0.004,
    });
    expect(usage).toEqual([{ sourceId: 'in.nclt.bengaluru', costDollars: 0.004 }]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      sourceId: 'in.nclt.bengaluru',
      status: 200,
      tier: 'http',
      costDollars: 0.004,
      urlHash: createHash('sha256').update(URL_OK).digest('hex'),
    });
    expect(JSON.stringify(logs)).not.toContain('abc');
  });

  it('logs a provider failure with status 0 and throws FetchError', async () => {
    const logs: FetchLogEntry[] = [];
    const failing = createFetcher({
      registry: { policyFor: () => Promise.resolve(COURT) },
      alterlab: { fetch: () => Promise.reject(new Error('boom')) },
      clock: { now: () => new Date(0) },
      usage: { record: () => Promise.resolve() },
      log: {
        record: (entry) => {
          logs.push(entry);
          return Promise.resolve();
        },
      },
    });

    await expect(failing.fetchSource('in.nclt.bengaluru', URL_OK)).rejects.toMatchObject({
      reason: 'provider_failed',
    });
    expect(logs[0]).toMatchObject({ status: 0, tier: null, costDollars: 0 });
  });

  it('errors when the provider overshoots the tier or cost cap', async () => {
    await expect(
      setup({}, { tierUsed: 'captcha' }).fetcher.fetchSource('in.nclt.bengaluru', URL_OK),
    ).rejects.toMatchObject({ reason: 'tier_exceeded' });
    await expect(
      setup({}, { costDollars: 0.5 }).fetcher.fetchSource('in.nclt.bengaluru', URL_OK),
    ).rejects.toBeInstanceOf(FetchError);
  });
});

describe('fetchSource: the captcha tier', () => {
  it('never reaches captcha for a court fetch without delegatedFor or a bulk clearance', async () => {
    const { fetcher, requests } = setup({ maxTier: 'captcha' });

    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);

    expect(requests.map((r) => r.maxTier)).toEqual(['proxy']);
  });

  it('never reaches captcha for a notice source either', async () => {
    const { fetcher, requests } = setup({ kind: 'notice', maxTier: 'headless' });

    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);

    expect(requests.map((r) => r.maxTier)).toEqual(['headless']);
  });

  it('lets a delegated lookup use captcha, within the per-advocate rate', async () => {
    const { fetcher, requests, usage, advance } = setup(
      { rateLimitPerMinute: 100 },
      { tierUsed: 'captcha' },
      { delegatedCaptchaPerHour: 2 },
    );
    const delegatedFor = { advocateId: 'adv-1', matterId: 'mat-1' };

    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK, { delegatedFor });
    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK, { delegatedFor });
    await expect(
      fetcher.fetchSource('in.nclt.bengaluru', URL_OK, { delegatedFor }),
    ).rejects.toMatchObject({ reason: 'advocate_rate_limited' });
    // Another advocate has their own allowance.
    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK, {
      delegatedFor: { advocateId: 'adv-2', matterId: 'mat-9' },
    });
    advance(3_600_001);
    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK, { delegatedFor });

    expect(requests.map((r) => r.maxTier)).toEqual(['captcha', 'captcha', 'captcha', 'captcha']);
    expect(usage[0]).toMatchObject({ delegatedFor });
  });

  it('refuses a delegation with an empty advocate or matter id', async () => {
    const { fetcher, requests } = setup();

    await expect(
      fetcher.fetchSource('in.nclt.bengaluru', URL_OK, {
        delegatedFor: { advocateId: '', matterId: 'm' },
      }),
    ).rejects.toBeInstanceOf(FetchDenied);
    expect(requests).toEqual([]);
  });

  it('allows captcha without delegation for a counsel-cleared bulk source', async () => {
    const { fetcher, requests } = setup({ captchaBulkCleared: true }, { tierUsed: 'captcha' });

    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);

    expect(requests.map((r) => r.maxTier)).toEqual(['captcha']);
  });

  it('leaves the stored tier as the cap for a news or licensed source', async () => {
    const { fetcher, requests } = setup(
      { kind: 'news', maxTier: 'captcha' },
      { tierUsed: 'captcha' },
    );

    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);

    expect(requests.map((r) => r.maxTier)).toEqual(['captcha']);
  });
});

describe('fetchSource: rate limit', () => {
  it('limits each source per minute, then recovers', async () => {
    const { fetcher, requests, advance } = setup({ rateLimitPerMinute: 2 });

    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);
    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);
    await expect(fetcher.fetchSource('in.nclt.bengaluru', URL_OK)).rejects.toMatchObject({
      reason: 'source_rate_limited',
    });
    expect(requests).toHaveLength(2);

    advance(60_001);
    await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);
    expect(requests).toHaveLength(3);
  });
});

describe('fetchSource: per-host budget (#636)', () => {
  it('shares one budget across sources on a host and spends nothing on a denial', async () => {
    const { fetcher, requests, logs, advance } = setup(
      { rateLimitPerMinute: 10 },
      {},
      { hostRequestsPerMinute: 2 },
    );

    await fetcher.fetchSource('in.a.district', URL_OK);
    await fetcher.fetchSource('in.b.district', URL_OK);
    await expect(fetcher.fetchSource('in.c.district', URL_OK)).rejects.toMatchObject({
      reason: 'source_rate_limited',
    });
    expect(requests).toHaveLength(2);
    expect(logs).toHaveLength(2);

    advance(60_001);
    await fetcher.fetchSource('in.c.district', URL_OK);
    expect(requests).toHaveLength(3);
  });

  it('keeps hosts independent', async () => {
    const { fetcher, requests } = setup(
      { rateLimitPerMinute: 10, baseUrl: 'https://nclt.gov.in' },
      {},
      { hostRequestsPerMinute: 1 },
    );
    await fetcher.fetchSource('in.a.district', URL_OK);
    await expect(fetcher.fetchSource('in.b.district', URL_OK)).rejects.toBeInstanceOf(FetchDenied);
    expect(requests).toHaveLength(1);
  });
});

describe('the mock provider', () => {
  it('serves fixtures offline when no API key is set, at zero cost and the cheapest tier', async () => {
    const provider = createProvider({
      apiKey: undefined,
      fixtures: { [URL_OK]: { body: 'fixture list', contentType: 'text/plain' } },
    });
    const fetcher = createFetcher({
      registry: { policyFor: () => Promise.resolve(COURT) },
      alterlab: provider,
      clock: { now: () => new Date(0) },
      usage: { record: () => Promise.resolve() },
      log: { record: () => Promise.resolve() },
    });

    const result = await fetcher.fetchSource('in.nclt.bengaluru', URL_OK);

    expect(result).toMatchObject({ body: 'fixture list', contentType: 'text/plain', status: 200 });
    expect(result.provenance).toMatchObject({ tierUsed: 'http', costDollars: 0 });
  });

  it('is deterministic for an unknown URL, and an empty key also selects the mock', async () => {
    const request: ProviderRequest = {
      url: URL_OK,
      maxTier: 'http',
      maxCostDollars: 0,
      proxyCountry: 'IN',
      failFast: true,
    };
    const a = await createMockProvider().fetch(request);
    const b = await createProvider({ apiKey: '' }).fetch(request);

    expect(b).toEqual(a);
  });
});
