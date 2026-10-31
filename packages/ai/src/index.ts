/** AI gateway: providers, routing, budgets, India-only mode, audit. See ADR 0007 and ADR 0022. */
export const packageName: string = '@causedeck/ai';

export * from './errors.ts';
export {
  createMockEmbedder,
  createProviderEmbedder,
  EMBEDDING_DIMENSIONS as AI_EMBEDDING_DIMENSIONS,
  guardEmbedder,
  requireIndiaRoute,
  type Embedder,
  type EmbedderRegion,
  type EmbeddingAuditSink,
  type EmbeddingRefusal,
  type ProviderEmbedderConfig,
} from './embeddings.ts';
export { createEmbedGateway, type EmbedGateway, type EmbedGatewayConfig } from './embed/gateway.ts';
export {
  BGE_M3_MODEL,
  COHERE_EMBED_MODEL,
  createBgem3Provider,
  createCohereEmbedProvider,
  createMockEmbedProvider,
  createTitanEmbedProvider,
  MOCK_EMBED_MODEL,
  TITAN_EMBED_MODEL,
  type Bgem3Config,
  type BedrockEmbedConfig,
  type MockEmbedConfig,
} from './embed/providers.ts';
export type * from './embed/types.ts';
export { createGateway, type AiGateway, type GatewayConfig } from './gateway.ts';
export { inputHash, normalise } from './hash.ts';
export type * from './ports.ts';
export {
  costPaise,
  embedCostPaise,
  EMBED_PRICES,
  estimatePaise,
  estimateUsage,
  PRICES,
  priceFor,
} from './pricing.ts';
export { detectInjection, wrapAsData } from './policy/injection.ts';
export { allowedChain, INDIA_REGIONS, isIndiaRegion } from './policy/residency.ts';
export { createBedrockProvider, type BedrockConfig } from './providers/bedrock.ts';
export { createMockProvider, withRecording } from './providers/mock.ts';
export { createSarvamProvider, type SarvamConfig } from './providers/sarvam.ts';
export { CircuitBreaker, withRetry } from './retry.ts';
export { getTask, TASKS } from './tasks/registry.ts';
export * from './types.ts';
