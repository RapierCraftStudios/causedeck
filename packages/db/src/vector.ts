import { vector } from 'drizzle-orm/pg-core';

/** Embedding width for every `vector` column. 1024 until an ADR decides the embedding model. */
export const EMBEDDING_DIMENSIONS = 1024;

/** A pgvector column sized to `EMBEDDING_DIMENSIONS`. */
export function embedding(name = 'embedding') {
  return vector(name, { dimensions: EMBEDDING_DIMENSIONS });
}
