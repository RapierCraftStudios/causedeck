// Embedding providers (#895, ADR 0051 §Vectors): Bedrock Cohere Embed Multilingual and Titan Text
// Embeddings v2 over InvokeModel (SigV4, no SDK, as in `providers/bedrock.ts`), a self-hosted bge-m3
// behind an HTTP endpoint, and a deterministic in-process mock (dev and CI: nothing leaves the process).
import { createHash } from 'node:crypto';

import { ProviderError } from '../errors.ts';
import { isIndiaRegion } from '../policy/residency.ts';
import { signRequest } from '../providers/sigv4.ts';
import type { EmbedBatch, EmbedProvider } from './types.ts';

export const COHERE_EMBED_MODEL = 'cohere.embed-multilingual-v3';
export const TITAN_EMBED_MODEL = 'amazon.titan-embed-text-v2:0';
export const BGE_M3_MODEL = 'bge-m3';
export const MOCK_EMBED_MODEL = 'mock-embed';

const THROTTLE = new Set([429, 503, 529]);

/** Providers that do not report token counts are billed on this estimate (4 characters a token). */
export const estimateTokens = (texts: readonly string[]): number =>
  Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);

export interface BedrockEmbedConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Output width; Titan v2 accepts 1024, 512 or 256, Cohere is fixed at 1024. */
  dimensions?: number;
  fetch?: typeof fetch;
  now?: () => Date;
}

async function post(
  provider: string,
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await doFetch(url, { method: 'POST', headers, body });
  } catch {
    throw new ProviderError(provider, 'network error', { retryable: true });
  }
  if (!response.ok) {
    throw new ProviderError(provider, `HTTP ${String(response.status)}`, {
      retryable: THROTTLE.has(response.status) || response.status >= 500,
      status: response.status,
    });
  }
  return response.json();
}

function invokeBedrock(config: BedrockEmbedConfig, id: string, model: string) {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  const host = `bedrock-runtime.${config.region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(model)}/invoke`;
  return (body: string): Promise<unknown> =>
    post(
      id,
      doFetch,
      `https://${host}${path}`,
      signRequest({
        region: config.region,
        service: 'bedrock',
        host,
        path,
        body,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        now: now(),
      }),
      body,
    );
}

export function createCohereEmbedProvider(config: BedrockEmbedConfig): EmbedProvider {
  const invoke = invokeBedrock(config, 'bedrock-cohere', COHERE_EMBED_MODEL);
  return {
    id: 'bedrock-cohere',
    region: config.region,
    dataResidency: isIndiaRegion(config.region) ? 'in' : 'other',
    model: COHERE_EMBED_MODEL,
    modelVersion: COHERE_EMBED_MODEL,
    dimensions: 1024,
    async embed(texts): Promise<EmbedBatch> {
      const json = (await invoke(
        JSON.stringify({ texts, input_type: 'search_document', truncate: 'END' }),
      )) as { embeddings?: number[][] };
      if (!Array.isArray(json.embeddings)) {
        throw new ProviderError('bedrock-cohere', 'malformed response');
      }
      return { vectors: json.embeddings, inputTokens: estimateTokens(texts) };
    },
  };
}

export function createTitanEmbedProvider(config: BedrockEmbedConfig): EmbedProvider {
  const invoke = invokeBedrock(config, 'bedrock-titan', TITAN_EMBED_MODEL);
  const dimensions = config.dimensions ?? 1024;
  return {
    id: 'bedrock-titan',
    region: config.region,
    dataResidency: isIndiaRegion(config.region) ? 'in' : 'other',
    model: TITAN_EMBED_MODEL,
    modelVersion: `${TITAN_EMBED_MODEL}@${String(dimensions)}`,
    dimensions,
    async embed(texts): Promise<EmbedBatch> {
      // Titan embeds one text a call.
      const vectors: number[][] = [];
      let inputTokens = 0;
      for (const text of texts) {
        const json = (await invoke(
          JSON.stringify({ inputText: text, dimensions, normalize: true }),
        )) as { embedding?: number[]; inputTextTokenCount?: number };
        if (!Array.isArray(json.embedding)) {
          throw new ProviderError('bedrock-titan', 'malformed response');
        }
        vectors.push(json.embedding);
        inputTokens += json.inputTextTokenCount ?? estimateTokens([text]);
      }
      return { vectors, inputTokens };
    },
  };
}

export interface Bgem3Config {
  /** Base URL of the self-hosted server (text-embeddings-inference `POST /embed`). */
  baseUrl: string;
  /** The region the server runs in; only an India region passes India-only mode. */
  region: string;
  /** Bearer token, when the server needs one. */
  token?: string;
  fetch?: typeof fetch;
}

export function createBgem3Provider(config: Bgem3Config): EmbedProvider {
  const doFetch = config.fetch ?? fetch;
  return {
    id: 'bge-m3',
    region: config.region,
    dataResidency: isIndiaRegion(config.region) ? 'in' : 'other',
    model: BGE_M3_MODEL,
    modelVersion: BGE_M3_MODEL,
    dimensions: 1024,
    async embed(texts): Promise<EmbedBatch> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (config.token !== undefined) headers.authorization = `Bearer ${config.token}`;
      const json = await post(
        'bge-m3',
        doFetch,
        `${config.baseUrl.replace(/\/$/, '')}/embed`,
        headers,
        JSON.stringify({ inputs: texts, normalize: true, truncate: true }),
      );
      if (!Array.isArray(json)) throw new ProviderError('bge-m3', 'malformed response');
      return { vectors: json as number[][], inputTokens: estimateTokens(texts) };
    },
  };
}

export interface MockEmbedConfig {
  dimensions?: number;
  /** Changing it models a new model version. */
  version?: string;
}

/** A deterministic bag-of-words hashing embedder, unit length, in the `ap-south-1` region label. */
export function createMockEmbedProvider(config: MockEmbedConfig = {}): EmbedProvider {
  const dimensions = config.dimensions ?? 1024;
  const embedOne = (text: string): number[] => {
    const vector = new Array<number>(dimensions).fill(0);
    for (const word of text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)) {
      const digest = createHash('sha256').update(word).digest();
      const index = digest.readUInt32BE(0) % dimensions;
      vector[index] = (vector[index] ?? 0) + ((digest[4] ?? 0) % 2 === 0 ? 1 : -1);
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((v) => v / norm);
  };
  return {
    id: 'mock-embed',
    region: 'local',
    dataResidency: 'in',
    model: MOCK_EMBED_MODEL,
    modelVersion: `${MOCK_EMBED_MODEL}@${config.version ?? '1'}`,
    dimensions,
    embed: (texts) =>
      Promise.resolve({ vectors: texts.map(embedOne), inputTokens: estimateTokens(texts) }),
  };
}
