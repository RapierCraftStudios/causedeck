// The rerank gateway (#896, ADR 0007, ADR 0022): India-only mode is checked before any text reaches a
// provider, every score list is checked against the document count, and the cost of each call is
// metered in paise from `RERANK_PRICES`. Errors never carry text.
import {
  AiGatewayError,
  NoProviderError,
  ProviderError,
  ResidencyViolationError,
} from '../errors.ts';
import { rerankCostPaise } from '../pricing.ts';
import { withRetry, type RetryOptions } from '../retry.ts';
import type { RerankProvider, RerankResult } from './types.ts';

export interface RerankGatewayConfig {
  providers: readonly RerankProvider[];
  /** Default true, like `workspace_settings.india_only_ai`. */
  indiaOnly?: boolean;
  retry?: RetryOptions;
}

export interface RerankGateway {
  /** The provider a call would use, without sending text. */
  active(): RerankProvider;
  rerank(query: string, documents: readonly string[]): Promise<RerankResult>;
}

export function createRerankGateway(config: RerankGatewayConfig): RerankGateway {
  const indiaOnly = config.indiaOnly ?? true;

  function active(): RerankProvider {
    const first = config.providers[0];
    if (first === undefined) throw new NoProviderError('rerank');
    if (indiaOnly && first.dataResidency !== 'in') {
      throw new ResidencyViolationError('rerank', first.id);
    }
    return first;
  }

  return {
    active,
    async rerank(query, documents) {
      const provider = active();
      const base = {
        provider: provider.id,
        model: provider.model,
        modelVersion: provider.modelVersion,
        region: provider.region,
      };
      if (documents.length === 0) return { ...base, scores: [], searches: 0, costPaise: 0 };
      const batch = await withRetry(() => provider.rerank(query, documents), config.retry ?? {});
      if (batch.scores.length !== documents.length) {
        throw new ProviderError(provider.id, 'wrong number of scores returned');
      }
      if (batch.scores.some((s) => !Number.isFinite(s))) {
        throw new AiGatewayError('RERANK_SCORE', `${provider.id}: a score is not a finite number`);
      }
      return { ...base, ...batch, costPaise: rerankCostPaise(provider.model, batch.searches) };
    },
  };
}
