// Types of the governed fetch layer (#479, D-048). The layer depends on nothing else in the
// workspace: the registry, provider, clock, usage and log sinks are injected as structural types
// (the core `policyFor` and `SourcePolicy` satisfy `FetchRegistry` and `FetchPolicy`).

import type { BlockSignature } from './block-signature.ts';

/** AlterLab fetch tiers in ascending cost; mirrors `SOURCE_MAX_TIERS` in `@causedeck/db`. */
export const FETCH_TIERS = ['http', 'headless', 'proxy', 'captcha'] as const;
export type FetchTier = (typeof FETCH_TIERS)[number];

/** Source kinds that are courts or government pages: never fetched through `captcha` by default. */
export const CAPTCHA_RESTRICTED_KINDS: readonly string[] = ['court', 'notice'];

/** The part of a source's policy the fetcher needs. */
export interface FetchPolicy {
  sourceId: string;
  kind: string;
  baseUrl: string;
  rateLimitPerMinute: number;
  maxTier: FetchTier;
  maxCostDollars: number;
  /** Counsel has cleared bulk captcha solving for this source (D-048). */
  captchaBulkCleared: boolean;
  /** Version of the registry row (`source.updated_at`, ISO). */
  version: string;
}

/** Throws (`SourceNotCleared` in core) for an unknown, uncleared or killed source. */
export interface FetchRegistry {
  policyFor(sourceId: string): Promise<FetchPolicy>;
}

export interface ProviderRequest {
  url: string;
  maxTier: FetchTier;
  maxCostDollars: number;
  proxyCountry: 'IN';
  failFast: true;
}

export interface ProviderResponse {
  status: number;
  body: string;
  contentType: string;
  tierUsed: FetchTier;
  costDollars: number;
}

export interface FetchProvider {
  fetch(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface FetchClock {
  now(): Date;
}

export interface DelegatedFor {
  advocateId: string;
  matterId: string;
}

export interface FetchOptions {
  /** A signed-in advocate's own lookup on their matter: the only way to reach `captcha` by default. */
  delegatedFor?: DelegatedFor;
}

export interface FetchProvenance {
  url: string;
  fetchedAt: string;
  sha256: string;
  sourceId: string;
  sourceVersion: string;
  tierUsed: FetchTier;
  costDollars: number;
}

export interface FetchResult {
  status: number;
  body: string;
  contentType: string;
  provenance: FetchProvenance;
}

/** One `fetch_log` row: ids, hashes and numbers only, never content. */
export interface FetchLogEntry {
  sourceId: string;
  urlHash: string;
  /** HTTP status; 0 when the provider failed before a response. */
  status: number;
  tier: FetchTier | null;
  costDollars: number;
  fetchedAt: Date;
  advocateId: string | null;
}

export interface FetchUsageEvent {
  sourceId: string;
  costDollars: number;
  delegatedFor?: DelegatedFor;
}

/** The evaluator's view of a source (#515): optional, so the fetcher works without it. */
export interface FetchHealth {
  /** The instant before which the source must not be fetched (block backoff), or `null`. */
  backoffUntil(sourceId: string): Promise<Date | null>;
  /** A block signature seen in a response; the evaluator backs the source off and alerts once. */
  reportBlock?(event: { sourceId: string; signature: BlockSignature; at: Date }): Promise<void>;
}

export interface FetchSinks {
  usage: { record(event: FetchUsageEvent): Promise<void> };
  log: { record(entry: FetchLogEntry): Promise<void> };
}

export type FetchDeniedReason =
  | 'invalid_url'
  | 'url_outside_source'
  | 'invalid_delegation'
  | 'source_rate_limited'
  | 'host_rate_limited'
  | 'advocate_rate_limited'
  | 'source_backed_off';

/** The fetcher refused before any network call. */
export class FetchDenied extends Error {
  readonly code = 'FETCH_DENIED' as const;
  constructor(
    readonly reason: FetchDeniedReason,
    readonly sourceId: string,
  ) {
    super(`Fetch of source ${sourceId} denied: ${reason}`);
    this.name = 'FetchDenied';
  }
}

export type FetchErrorReason = 'provider_failed' | 'tier_exceeded' | 'cost_exceeded';

/** The provider failed or broke a cap after the call. */
export class FetchError extends Error {
  readonly code = 'FETCH_ERROR' as const;
  constructor(
    readonly reason: FetchErrorReason,
    readonly sourceId: string,
    options?: { cause?: unknown },
  ) {
    super(`Fetch of source ${sourceId} failed: ${reason}`, options);
    this.name = 'FetchError';
  }
}
