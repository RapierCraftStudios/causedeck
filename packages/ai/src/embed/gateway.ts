// The embedding gateway (#895, ADR 0007, ADR 0022): India-only mode is checked before any text
// reaches a provider, every vector is checked against the provider's width, and the cost of each
// batch is metered in paise from `EMBED_PRICES`. Only the first allowed provider is used: vectors of
// two models must never share a column, so there is no cross-model failover. Errors never carry text.
import {
  AiGatewayError,
  NoProviderError,
  ProviderError,
  ResidencyViolationError,
} from '../errors.ts';
import { embedCostPaise } from '../pricing.ts';
import { withRetry, type RetryOptions } from '../retry.ts';
import type { EmbedProvider, EmbedResult } from './types.ts';

export interface EmbedGatewayConfig {
  providers: readonly EmbedProvider[];
  /** Default true, like `workspace_settings.india_only_ai`. */
  indiaOnly?: boolean;
  retry?: RetryOptions;
}

export interface EmbedGateway {
  /** The provider a call would use, for reading its model version without sending text. */
  active(): EmbedProvider;
  embed(texts: readonly string[]): Promise<EmbedResult>;
}

export function createEmbedGateway(config: EmbedGatewayConfig): EmbedGateway {
  const indiaOnly = config.indiaOnly ?? true;

  function active(): EmbedProvider {
    const first = config.providers[0];
    if (first === undefined) throw new NoProviderError('embed');
    if (indiaOnly && first.dataResidency !== 'in') {
      throw new ResidencyViolationError('embed', first.id);
    }
    return first;
  }

  return {
    active,
    async embed(texts) {
      const provider = active();
      if (texts.length === 0) {
        return {
          vectors: [],
          inputTokens: 0,
          provider: provider.id,
          model: provider.model,
          modelVersion: provider.modelVersion,
          region: provider.region,
          costPaise: 0,
        };
      }
      const batch = await withRetry(() => provider.embed(texts), config.retry ?? {});
      if (batch.vectors.length !== texts.length) {
        throw new ProviderError(provider.id, 'wrong number of vectors returned');
      }
      for (const v of batch.vectors) {
        if (v.length !== provider.dimensions) {
          throw new AiGatewayError(
            'EMBED_WIDTH',
            `${provider.id}: vector has ${String(v.length)} dimensions, expected ${String(provider.dimensions)}`,
          );
        }
      }
      return {
        ...batch,
        provider: provider.id,
        model: provider.model,
        modelVersion: provider.modelVersion,
        region: provider.region,
        costPaise: embedCostPaise(provider.model, batch.inputTokens),
      };
    },
  };
}
