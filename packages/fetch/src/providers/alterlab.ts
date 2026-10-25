// The AlterLab provider: the only module in the workspace that imports the `alterlab` SDK (2.4.0).
// The SDK has no dollar cap, so the cap goes in as `max_credits` and the cost comes back from the
// billing details in microcents; the fetcher re-checks both after the call.
import { AlterLab, type ScrapeRequest, type ScrapeResponse } from 'alterlab';

import { createMockProvider, type MockFixture } from './mock.ts';
import type { FetchProvider, FetchTier, ProviderRequest, ProviderResponse } from '../types.ts';

/** SDK tier names (`0.5` ... `4`) for each of our tiers. */
const SDK_TIER: Readonly<Record<FetchTier, string>> = {
  http: '1.5',
  headless: '2',
  proxy: '3',
  captcha: '4',
};

const MICROCENTS_PER_DOLLAR = 100_000_000;

/** Credits per dollar used to turn `maxCostDollars` into the SDK's `max_credits`. */
export const DEFAULT_CREDITS_PER_DOLLAR = 1000;

/** Anything above tier 3 may have solved a challenge, so it is reported as `captcha`. */
export function tierFromSdk(tier: string | undefined): FetchTier {
  const n = Number(tier);
  if (!Number.isFinite(n) || tier === undefined) return 'captcha';
  if (n <= 1.5) return 'http';
  if (n <= 2) return 'headless';
  if (n <= 3) return 'proxy';
  return 'captcha';
}

export interface AlterlabClient {
  scrape(request: ScrapeRequest): Promise<ScrapeResponse>;
}

export function createAlterlabProvider(
  client: AlterlabClient,
  { creditsPerDollar = DEFAULT_CREDITS_PER_DOLLAR }: { creditsPerDollar?: number } = {},
): FetchProvider {
  return {
    async fetch(request: ProviderRequest): Promise<ProviderResponse> {
      const response = await client.scrape({
        url: request.url,
        sync: true,
        proxy_country: request.proxyCountry,
        cost_controls: {
          max_tier: SDK_TIER[request.maxTier],
          max_credits: request.maxCostDollars * creditsPerDollar,
          fail_fast: request.failFast,
        },
      });
      const tierUsed = tierFromSdk(response.billing?.tier_used ?? response.tier_used);
      const microcents = response.billing?.final_cost_microcents;
      const costDollars =
        microcents === undefined || microcents === null
          ? response.credits_used / creditsPerDollar
          : microcents / MICROCENTS_PER_DOLLAR;
      const content = response.html ?? response.content;
      return {
        status: response.status_code,
        body: typeof content === 'string' ? content : JSON.stringify(content),
        contentType: response.headers['content-type'] ?? 'text/html',
        tierUsed,
        costDollars,
      };
    },
  };
}

/** The AlterLab provider when a key is set, else the offline mock (never a half-configured one). */
export function createProvider({
  apiKey,
  fixtures,
}: {
  apiKey?: string | undefined;
  fixtures?: Readonly<Record<string, MockFixture>>;
}): FetchProvider {
  if (apiKey === undefined || apiKey === '') return createMockProvider(fixtures);
  return createAlterlabProvider(new AlterLab({ apiKey }));
}
