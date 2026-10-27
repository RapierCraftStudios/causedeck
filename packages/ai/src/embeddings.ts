// Embeddings over the India-only route (#901, ADR 0046, ADR 0007). Style and precedent search ranks
// a lawyer's own approved passages by vector similarity; nothing is ever trained on them. The
// default embedder is the in-process hashing mock (dev and CI: nothing leaves the process). A
// provider embedder is accepted only when its region is in India (`policy/residency.ts`); any other
// region is refused before a single character is sent, and the refusal goes to the injected audit
// sink. This module has no training or fine-tuning client by design (static test in
// `__tests__/embeddings.test.ts`).
import { createHash } from 'node:crypto';

import { ResidencyViolationError } from './errors.ts';
import { isIndiaRegion } from './policy/residency.ts';

/** Vector size of `memory_embedding.embedding` (`@causedeck/db` EMBEDDING_DIMENSIONS). */
export const EMBEDDING_DIMENSIONS = 1024;

/** `local` runs in this process, `india` is a provider in an India region, `other` is refused. */
export type EmbedderRegion = 'local' | 'india' | 'other';

export interface Embedder {
  readonly id: string;
  readonly region: EmbedderRegion;
  embed(text: string): Promise<number[]>;
}

export interface EmbeddingRefusal {
  readonly kind: 'embedding.refused';
  readonly embedderId: string;
  readonly region: string;
  readonly reason: 'outside_india';
}

/** Receives every refusal; the caller wires it to the audit log. It never receives text. */
export type EmbeddingAuditSink = (event: EmbeddingRefusal) => void | Promise<void>;

/** A deterministic bag-of-words hashing embedder, unit length: the mock provider. */
export function createMockEmbedder(id = 'mock-embedder'): Embedder {
  return {
    id,
    region: 'local',
    embed(text) {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const word of text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)) {
        const digest = createHash('sha256').update(word).digest();
        const index = digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
        vector[index] = (vector[index] ?? 0) + ((digest[4] ?? 0) % 2 === 0 ? 1 : -1);
      }
      const norm = Math.hypot(...vector) || 1;
      return Promise.resolve(vector.map((v) => v / norm));
    },
  };
}

export interface ProviderEmbedderConfig {
  readonly id: string;
  /** The provider's data-residency region, e.g. `ap-south-1`. Anything outside India is refused. */
  readonly region: string;
  readonly embed: (text: string) => Promise<number[]>;
}

/** Wrap a provider call as an `Embedder`; the region decides whether the route will accept it. */
export function createProviderEmbedder(config: ProviderEmbedderConfig): Embedder & {
  readonly providerRegion: string;
} {
  return {
    id: config.id,
    region: isIndiaRegion(config.region) ? 'india' : 'other',
    providerRegion: config.region,
    embed: config.embed,
  };
}

/**
 * Return `embedder` if it may be used, otherwise audit the refusal and throw. Call it before any
 * text is handed to the embedder.
 */
export async function requireIndiaRoute(
  embedder: Embedder,
  audit: EmbeddingAuditSink,
): Promise<Embedder> {
  if (embedder.region !== 'other') return embedder;
  const region = (embedder as { providerRegion?: string }).providerRegion ?? 'unknown';
  await audit({
    kind: 'embedding.refused',
    embedderId: embedder.id,
    region,
    reason: 'outside_india',
  });
  throw new ResidencyViolationError('embedding', embedder.id);
}

/** An embedder that checks the route on every call and returns vectors of the registered size. */
export function guardEmbedder(embedder: Embedder, audit: EmbeddingAuditSink): Embedder {
  return {
    id: embedder.id,
    region: embedder.region,
    async embed(text) {
      await requireIndiaRoute(embedder, audit);
      const vector = await embedder.embed(text);
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new RangeError(
          `Embedding has ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
        );
      }
      return vector;
    },
  };
}
