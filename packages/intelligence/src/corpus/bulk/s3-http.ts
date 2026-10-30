// Anonymous reads of a public S3 bucket over HTTPS (the `--no-sign-request` equivalent, #890):
// ListObjectsV2 for the keys, a plain GET for an object. Every request stays on the bucket's own
// host; the caller has already cleared the source through `policyFor`.
import type { BulkObjectSource } from './types.ts';

export type HttpFetch = (url: string) => Promise<Response>;

const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');

const unescapeXml = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export class BulkHttpError extends Error {
  override name = 'BulkHttpError';
  constructor(readonly status: number) {
    super(`bulk read failed with HTTP ${String(status)}`);
  }
}

/**
 * The only hosts a bulk import reads: the two CC-BY-4.0 AWS Open Data buckets (ADR 0051, D-053).
 * Another host is refused, so a source row cannot point the importer anywhere else.
 */
export const BULK_DATASET_HOSTS: ReadonlySet<string> = new Set([
  'indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com',
  'indian-high-court-judgments.s3.ap-south-1.amazonaws.com',
]);

export function createS3HttpSource(
  baseUrl: string,
  // nosemgrep: infra.security.semgrep.causedeck.fetch-to-unlisted-host -- anonymous reads pinned to BULK_DATASET_HOSTS below
  fetchFn: HttpFetch = (url) => fetch(url),
): BulkObjectSource {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || !BULK_DATASET_HOSTS.has(base.host)) {
    throw new BulkHttpError(0);
  }
  const get = async (url: string): Promise<Response> => {
    if (new URL(url).host !== base.host) throw new BulkHttpError(0);
    const response = await fetchFn(url);
    if (!response.ok) throw new BulkHttpError(response.status);
    return response;
  };
  const objectUrl = (key: string): string => new URL(encodeKey(key), base).toString();

  return {
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const url = new URL(base);
        url.searchParams.set('list-type', '2');
        url.searchParams.set('prefix', prefix);
        if (token !== undefined) url.searchParams.set('continuation-token', token);
        const xml = await (await get(url.toString())).text();
        for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
          keys.push(unescapeXml(match[1] ?? ''));
        }
        const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? unescapeXml(next?.[1] ?? '')
          : undefined;
      } while (token !== undefined && token !== '');
      return keys;
    },
    async read(key) {
      return new Uint8Array(await (await get(objectUrl(key))).arrayBuffer());
    },
    async *stream(key) {
      const response = await get(objectUrl(key));
      if (response.body === null) return;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) yield chunk;
    },
  };
}
