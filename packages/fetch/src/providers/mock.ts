// The offline provider: deterministic fixtures, zero cost, always the cheapest tier. Used whenever
// `ALTERLAB_API_KEY` is unset, so every downstream test runs without a network.
import type { FetchProvider, ProviderResponse } from '../types.ts';

export interface MockFixture {
  body: string;
  contentType?: string;
  status?: number;
}

export function createMockProvider(
  fixtures: Readonly<Record<string, MockFixture>> = {},
): FetchProvider {
  return {
    fetch(request): Promise<ProviderResponse> {
      const fixture = fixtures[request.url];
      return Promise.resolve({
        status: fixture?.status ?? 200,
        body: fixture?.body ?? `<html><body>mock fixture for ${request.url}</body></html>`,
        contentType: fixture?.contentType ?? 'text/html; charset=utf-8',
        tierUsed: 'http',
        costDollars: 0,
      });
    },
  };
}
