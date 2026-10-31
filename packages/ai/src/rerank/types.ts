// The rerank port (#896, ADR 0051 §Query pipeline step 4). Like `EmbedProvider` it is separate from
// the JSON-task `Provider` interface: scoring documents against a query returns numbers, not a parsed
// object. There is no training, tool or retrieval parameter on this interface, and a provider sees
// only redacted corpus passages (public judgments) and the query text.
export interface RerankBatch {
  /** One relevance score per document, in the order the documents were sent (higher is better). */
  scores: number[];
  /** Billable searches: one per call for Cohere Rerank, 0 for self-hosted models. */
  searches: number;
}

export interface RerankProvider {
  readonly id: string;
  /** The provider's data-residency region, e.g. `ap-south-1`. */
  readonly region: string;
  /** `in` only for in-region India processing. */
  readonly dataResidency: 'in' | 'other';
  /** Model id, priced in `RERANK_PRICES`. */
  readonly model: string;
  readonly modelVersion: string;
  rerank(query: string, documents: readonly string[]): Promise<RerankBatch>;
}

export interface RerankResult extends RerankBatch {
  provider: string;
  model: string;
  modelVersion: string;
  region: string;
  costPaise: number;
}
