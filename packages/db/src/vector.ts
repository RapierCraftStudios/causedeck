import { halfvec, vector } from 'drizzle-orm/pg-core';

/** Embedding width for every `vector` column. 1024 until an ADR decides the embedding model. */
export const EMBEDDING_DIMENSIONS = 1024;

/** A pgvector column sized to `EMBEDDING_DIMENSIONS`. */
export function embedding(name = 'embedding') {
  return vector(name, { dimensions: EMBEDDING_DIMENSIONS });
}

/** Embedding width of `judgment_segment.embedding` (ADR 0051 §Vectors); the width is chosen in docs/engineering/corpus-embedding-model.md. */
export const CORPUS_EMBEDDING_DIMENSIONS = 1024;

/** A pgvector `halfvec` column sized to `CORPUS_EMBEDDING_DIMENSIONS` (2 bytes a dimension). */
export function halfvecEmbedding(name = 'embedding') {
  return halfvec(name, { dimensions: CORPUS_EMBEDDING_DIMENSIONS });
}
