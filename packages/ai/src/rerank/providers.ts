// Rerank providers (#896, ADR 0051 §Query pipeline): Cohere Rerank on Bedrock over InvokeModel (SigV4,
// no SDK, as in `embed/providers.ts`), a self-hosted bge-reranker behind an HTTP endpoint (config-gated:
// it is built only when a base URL is configured), and a deterministic in-process mock (dev, CI and
// staging: nothing leaves the process).
import { ProviderError } from '../errors.ts';
import { invokeBedrock, post, type BedrockEmbedConfig } from '../embed/providers.ts';
import { isIndiaRegion } from '../policy/residency.ts';
import type { RerankBatch, RerankProvider } from './types.ts';

export const COHERE_RERANK_MODEL = 'cohere.rerank-v3-5:0';
export const BGE_RERANKER_MODEL = 'bge-reranker-v2-m3';
export const MOCK_RERANK_MODEL = 'mock-rerank';

export type BedrockRerankConfig = Pick<
  BedrockEmbedConfig,
  'region' | 'accessKeyId' | 'secretAccessKey' | 'fetch' | 'now'
>;

/** Scores from a list of `{ index, score }` results, in document order; a missing index is an error. */
function scoresByIndex(provider: string, results: unknown, count: number, field: string): number[] {
  if (!Array.isArray(results)) throw new ProviderError(provider, 'malformed response');
  const scores = new Array<number | undefined>(count).fill(undefined);
  for (const r of results as Record<string, unknown>[]) {
    const index = r.index;
    const score = r[field];
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= count ||
      typeof score !== 'number'
    ) {
      throw new ProviderError(provider, 'malformed response');
    }
    scores[index] = score;
  }
  if (scores.some((s) => s === undefined)) throw new ProviderError(provider, 'malformed response');
  return scores as number[];
}

export function createCohereRerankProvider(config: BedrockRerankConfig): RerankProvider {
  const invoke = invokeBedrock(config, 'bedrock-cohere-rerank', COHERE_RERANK_MODEL);
  return {
    id: 'bedrock-cohere-rerank',
    region: config.region,
    dataResidency: isIndiaRegion(config.region) ? 'in' : 'other',
    model: COHERE_RERANK_MODEL,
    modelVersion: COHERE_RERANK_MODEL,
    async rerank(query, documents): Promise<RerankBatch> {
      const json = (await invoke(
        JSON.stringify({
          query,
          documents,
          top_n: documents.length,
          api_version: 2,
        }),
      )) as { results?: unknown };
      return {
        scores: scoresByIndex(
          'bedrock-cohere-rerank',
          json.results,
          documents.length,
          'relevance_score',
        ),
        // Cohere bills one search per 100 documents.
        searches: Math.ceil(documents.length / 100),
      };
    },
  };
}

export interface BgeRerankerConfig {
  /** Base URL of the self-hosted server (text-embeddings-inference `POST /rerank`). */
  baseUrl: string;
  /** The region the server runs in; only an India region passes India-only mode. */
  region: string;
  token?: string;
  fetch?: typeof fetch;
}

export function createBgeRerankProvider(config: BgeRerankerConfig): RerankProvider {
  const doFetch = config.fetch ?? fetch;
  return {
    id: 'bge-reranker',
    region: config.region,
    dataResidency: isIndiaRegion(config.region) ? 'in' : 'other',
    model: BGE_RERANKER_MODEL,
    modelVersion: BGE_RERANKER_MODEL,
    async rerank(query, documents): Promise<RerankBatch> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (config.token !== undefined) headers.authorization = `Bearer ${config.token}`;
      const json = await post(
        'bge-reranker',
        doFetch,
        `${config.baseUrl.replace(/\/$/, '')}/rerank`,
        headers,
        JSON.stringify({ query, texts: documents, truncate: true }),
      );
      return {
        scores: scoresByIndex('bge-reranker', json, documents.length, 'score'),
        searches: 0,
      };
    },
  };
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * A deterministic lexical reranker: the share of the query's distinct words a document contains,
 * weighted by word length (long words carry the facts, short ones are function words). In the
 * `local` region label, allowed under India-only mode because nothing leaves the process.
 */
export function createMockRerankProvider(): RerankProvider {
  return {
    id: 'mock-rerank',
    region: 'local',
    dataResidency: 'in',
    model: MOCK_RERANK_MODEL,
    modelVersion: `${MOCK_RERANK_MODEL}@1`,
    rerank(query, documents): Promise<RerankBatch> {
      const terms = [...new Set(words(query))].filter((w) => w.length > 2);
      const total = terms.reduce((n, w) => n + w.length, 0) || 1;
      const scores = documents.map((doc) => {
        const present = new Set(words(doc));
        return terms.reduce((n, w) => n + (present.has(w) ? w.length : 0), 0) / total;
      });
      return Promise.resolve({ scores, searches: 0 });
    },
  };
}
