// The batch embedding port (#895, ADR 0051 §Vectors). It is separate from the JSON-task `Provider`
// interface: an embedding call returns float vectors for many texts, not a parsed JSON object. There
// is no training, fine-tuning, tool or retrieval parameter anywhere on this interface.
export interface EmbedUsage {
  /** Tokens billed for the batch (an estimate when the provider does not report them). */
  inputTokens: number;
}

export interface EmbedBatch extends EmbedUsage {
  vectors: number[][];
}

export interface EmbedProvider {
  readonly id: string;
  /** The provider's data-residency region, e.g. `ap-south-1`. */
  readonly region: string;
  /** `in` only for in-region India processing. */
  readonly dataResidency: 'in' | 'other';
  /** Model id, priced in `EMBED_PRICES`. */
  readonly model: string;
  /** Stored per segment: a change re-embeds through the corpus.embed job. */
  readonly modelVersion: string;
  /** Width of every returned vector. */
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<EmbedBatch>;
}

export interface EmbedResult extends EmbedBatch {
  provider: string;
  model: string;
  modelVersion: string;
  region: string;
  costPaise: number;
}
