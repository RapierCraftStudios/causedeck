// Indian Kanoon API client (#77). One search per citation. Only the citation, the canonical document
// URL and a short title are kept: the headline text the API returns is read to confirm the citation
// and then dropped, never stored. A timeout, a 429, a 5xx or a network error is retried with
// jittered backoff and then reported as `unavailable`, which classifies as `unknown`.
import { normalizedCitationsIn } from '../normalize';
import { shortTitle, type ResolverHit, type ResolverOutcome } from '../match';

import type { CitationResolver, ResolveRequest } from './types';

export interface IndianKanoonOptions {
  token: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Retries after the first attempt. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface SearchDoc {
  tid?: number | string;
  title?: string;
  headline?: string;
}

export function createIndianKanoonResolver(options: IndianKanoonOptions): CitationResolver {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? 'https://api.indiankanoon.org';
  const timeoutMs = options.timeoutMs ?? 5000;
  const retries = options.retries ?? 2;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  async function attempt(request: ResolveRequest): Promise<ResolverOutcome | 'retry'> {
    const url = `${baseUrl}/search/?formInput=${encodeURIComponent(`"${request.normalized}"`)}&pagenum=0`;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Token ${options.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return 'retry';
    }
    if (response.status === 429 || response.status >= 500) return 'retry';
    if (!response.ok) return { kind: 'unavailable' };
    let body: { docs?: SearchDoc[] };
    try {
      body = (await response.json()) as { docs?: SearchDoc[] };
    } catch {
      return { kind: 'unavailable' };
    }
    const hits: ResolverHit[] = [];
    for (const doc of body.docs ?? []) {
      if (doc.tid === undefined || doc.title === undefined) continue;
      const carried = normalizedCitationsIn(`${doc.title} ${doc.headline ?? ''}`);
      if (!carried.includes(request.normalized)) continue;
      hits.push({
        citation: request.normalized,
        title: shortTitle(doc.title),
        sourceUrl: `https://indiankanoon.org/doc/${String(doc.tid)}/`,
      });
    }
    return { kind: 'hits', hits };
  }

  return {
    name: 'indian-kanoon',
    external: true,
    async resolve(request) {
      for (let n = 0; n <= retries; n += 1) {
        const result = await attempt(request);
        if (result !== 'retry') return result;
        if (n < retries) await sleep(2 ** n * 250 * (1 + random()));
      }
      return { kind: 'unavailable' };
    },
  };
}
