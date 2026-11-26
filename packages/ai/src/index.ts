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
export {
  createRerankGateway,
  type RerankGateway,
  type RerankGatewayConfig,
} from './rerank/gateway.ts';
export {
  BGE_RERANKER_MODEL,
  COHERE_RERANK_MODEL,
  createBgeRerankProvider,
  createCohereRerankProvider,
  createMockRerankProvider,
  MOCK_RERANK_MODEL,
  type BedrockRerankConfig,
  type BgeRerankerConfig,
} from './rerank/providers.ts';
export type * from './rerank/types.ts';
export { createGateway, type AiGateway, type GatewayConfig } from './gateway.ts';
export { inputHash, normalise } from './hash.ts';
export type * from './ports.ts';
export {
  costPaise,
  embedCostPaise,
  EMBED_PRICES,
  rerankCostPaise,
  RERANK_PRICES,
  estimatePaise,
  estimateUsage,
  PRICES,
  priceFor,
} from './pricing.ts';
export { detectInjection, wrapAsData } from './policy/injection.ts';
export {
  allowedChain,
  embedDataResidency,
  INDIA_REGIONS,
  isIndiaRegion,
  PREVIEW_PLAN_PROVIDER_ID,
  SELF_HOSTED_REGION,
  type AllowedChainOptions,
  type EmbedDataResidencyOptions,
} from './policy/residency.ts';
export { createBedrockProvider, type BedrockConfig } from './providers/bedrock.ts';
export {
  buildResponsesRequest,
  CHATGPT_PLAN_RESPONSES_URL,
  CHATGPT_PLAN_TASKS,
  createChatgptPlanProvider,
  type ChatgptPlanConfig,
  type ChatgptPlanTokenSource,
  type ResponsesRequest,
} from './providers/chatgpt-plan.ts';
export {
  CHATGPT_PLAN_RESOURCE,
  CHATGPT_PLAN_TOKEN_URL,
  createChatgptPlanTokenStore,
  readTokenFile as readChatgptPlanTokenFile,
  writeTokenFileAtomic as writeChatgptPlanTokenFileAtomic,
  type ChatgptPlanTokenFile,
  type ChatgptPlanTokenStoreConfig,
} from './providers/chatgpt-plan-token.ts';
export {
  buildAuthorizeUrl,
  CHATGPT_PLAN_AUTHORIZE_URL,
  CHATGPT_PLAN_OPENID_CONFIGURATION,
  CHATGPT_PLAN_REDIRECT_URI,
  CHATGPT_PLAN_SCOPES,
  createPkce,
  DYNAMIC_CLIENT_ID,
  exchangeCode,
  LoginError as ChatgptPlanLoginError,
  newHostId,
  parseCallback,
  PLAN_USAGE_SCOPE,
  randomToken,
  verifyIdToken,
  writeTokenFile as writeChatgptPlanTokenFile,
  type AuthorizeUrlInput,
  type Callback as ChatgptPlanCallback,
  type IdTokenClaims,
  type Pkce,
  type TokenReply as ChatgptPlanTokenReply,
} from './providers/chatgpt-plan-login.ts';
export { createMockProvider, withRecording } from './providers/mock.ts';
export { createSarvamProvider, type SarvamConfig } from './providers/sarvam.ts';
export { CircuitBreaker, withRetry } from './retry.ts';
export { getTask, TASKS } from './tasks/registry.ts';
export * from './types.ts';
