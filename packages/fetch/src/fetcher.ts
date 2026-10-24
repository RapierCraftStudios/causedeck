// The governed fetcher (#479, D-048). Every external read goes through `fetchSource`, which fails
// closed: the registry decides first (an unknown, uncleared or killed source throws before any
// network call, on every call), then the URL, the rate limits and the tier cap are checked, and
// only then is the provider called with India routing, fail-fast and the source's caps.
import { createHash } from 'node:crypto';

import { detectBlockSignature } from './block-signature.ts';
import { createRateLimiter } from './rate-limit.ts';
import {
  CAPTCHA_RESTRICTED_KINDS,
  FETCH_TIERS,
  FetchDenied,
  FetchError,
  type FetchClock,
  type FetchHealth,
  type FetchOptions,
  type FetchPolicy,
  type FetchProvider,
  type FetchRegistry,
  type FetchResult,
  type FetchSinks,
  type FetchTier,
} from './types.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Default per-advocate allowance for delegated `captcha` lookups. */
export const DEFAULT_DELEGATED_CAPTCHA_PER_HOUR = 10;

/** Default budget for all sources that share one host (state sources of one portal share it). */
export const DEFAULT_HOST_REQUESTS_PER_MINUTE = 30;

export interface FetcherDeps extends FetchSinks {
  registry: FetchRegistry;
  /** The AlterLab provider, or the mock when `ALTERLAB_API_KEY` is unset. */
  alterlab: FetchProvider;
  clock: FetchClock;
  delegatedCaptchaPerHour?: number;
  /** Requests per minute across every source on one host; defaults to `DEFAULT_HOST_REQUESTS_PER_MINUTE`. */
  hostRequestsPerMinute?: number;
  /** Backoff and block reporting from the data-ops evaluator (#515); absent means neither. */
  health?: FetchHealth;
}

export interface Fetcher {
  fetchSource(sourceId: string, url: string, opts?: FetchOptions): Promise<FetchResult>;
}

const rank = (tier: FetchTier): number => FETCH_TIERS.indexOf(tier);

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function checkUrl(policy: FetchPolicy, url: string): void {
  let target: URL;
  let base: URL;
  try {
    target = new URL(url);
    base = new URL(policy.baseUrl);
  } catch {
    throw new FetchDenied('invalid_url', policy.sourceId);
  }
  const web = (u: URL) => u.protocol === 'https:' || u.protocol === 'http:';
  if (!web(target) || !web(base)) throw new FetchDenied('invalid_url', policy.sourceId);
  if (target.host !== base.host) throw new FetchDenied('url_outside_source', policy.sourceId);
}

/**
 * The costliest tier this call may use. Court and notice sources stop below `captcha` unless the
 * call is a delegated lookup or the registry row carries a bulk-solving clearance; the raised cap
 * is computed here and never stored (the DB CHECK keeps court and notice rows off `captcha`).
 */
function tierCap(policy: FetchPolicy, delegated: boolean): FetchTier {
  if (!CAPTCHA_RESTRICTED_KINDS.includes(policy.kind)) return policy.maxTier;
  if (policy.captchaBulkCleared || delegated) return 'captcha';
  return rank(policy.maxTier) > rank('proxy') ? 'proxy' : policy.maxTier;
}

export function createFetcher(deps: FetcherDeps): Fetcher {
  const limiter = createRateLimiter(() => deps.clock.now().getTime());
  const perHost = deps.hostRequestsPerMinute ?? DEFAULT_HOST_REQUESTS_PER_MINUTE;
  const perAdvocate = deps.delegatedCaptchaPerHour ?? DEFAULT_DELEGATED_CAPTCHA_PER_HOUR;

  async function fetchSource(
    sourceId: string,
    url: string,
    opts: FetchOptions = {},
  ): Promise<FetchResult> {
    // The registry first, on every call: also the kill-switch check.
    const policy = await deps.registry.policyFor(sourceId);
    checkUrl(policy, url);

    // A backed-off source (block signature, #515) is refused before any rate-limit slot or network call.
    const backoffUntil = (await deps.health?.backoffUntil(sourceId)) ?? null;
    if (backoffUntil !== null && backoffUntil.getTime() > deps.clock.now().getTime()) {
      throw new FetchDenied('source_backed_off', sourceId);
    }

    const { delegatedFor } = opts;
    if (
      delegatedFor !== undefined &&
      (delegatedFor.advocateId === '' || delegatedFor.matterId === '')
    ) {
      throw new FetchDenied('invalid_delegation', sourceId);
    }
    const maxTier = tierCap(policy, delegatedFor !== undefined);
    // A delegated lookup only spends the advocate's allowance when it can reach `captcha`.
    const advocateKey =
      delegatedFor !== undefined && maxTier === 'captcha' && !policy.captchaBulkCleared
        ? `advocate:${delegatedFor.advocateId}`
        : null;

    const sourceKey = `source:${sourceId}`;
    if (!limiter.canAcquire(sourceKey, policy.rateLimitPerMinute, MINUTE_MS)) {
      throw new FetchDenied('source_rate_limited', sourceId);
    }
    // Per-host budget: sources of one portal (e.g. every state's eCourts district source) share it.
    // Denied as `source_rate_limited` so callers that defer on a rate limit treat it the same way.
    const hostKey = `host:${new URL(url).host}`;
    if (!limiter.canAcquire(hostKey, perHost, MINUTE_MS)) {
      throw new FetchDenied('source_rate_limited', sourceId);
    }
    if (advocateKey !== null && !limiter.canAcquire(advocateKey, perAdvocate, HOUR_MS)) {
      throw new FetchDenied('advocate_rate_limited', sourceId);
    }
    limiter.tryAcquire(sourceKey, policy.rateLimitPerMinute, MINUTE_MS);
    limiter.tryAcquire(hostKey, perHost, MINUTE_MS);
    if (advocateKey !== null) limiter.tryAcquire(advocateKey, perAdvocate, HOUR_MS);

    const urlHash = sha256(url);
    const advocateId = delegatedFor?.advocateId ?? null;
    let response;
    try {
      response = await deps.alterlab.fetch({
        url,
        maxTier,
        maxCostDollars: policy.maxCostDollars,
        proxyCountry: 'IN',
        failFast: true,
      });
    } catch (cause) {
      await deps.log.record({
        sourceId,
        urlHash,
        status: 0,
        tier: null,
        costDollars: 0,
        fetchedAt: deps.clock.now(),
        advocateId,
      });
      throw new FetchError('provider_failed', sourceId, { cause });
    }

    const fetchedAt = deps.clock.now();
    await deps.log.record({
      sourceId,
      urlHash,
      status: response.status,
      tier: response.tierUsed,
      costDollars: response.costDollars,
      fetchedAt,
      advocateId,
    });
    await deps.usage.record({
      sourceId,
      costDollars: response.costDollars,
      ...(delegatedFor === undefined ? {} : { delegatedFor }),
    });

    // A block signature backs the source off and alerts once (#515); reporting never fails a fetch.
    const signature = detectBlockSignature(response.status, response.body, response.contentType);
    if (signature !== null && deps.health?.reportBlock !== undefined) {
      await deps.health.reportBlock({ sourceId, signature, at: fetchedAt }).catch(() => undefined);
    }

    // Defence in depth: a provider that overshoots a cap is an error, and the body is dropped.
    if (rank(response.tierUsed) > rank(maxTier)) throw new FetchError('tier_exceeded', sourceId);
    if (response.costDollars > policy.maxCostDollars) {
      throw new FetchError('cost_exceeded', sourceId);
    }

    return {
      status: response.status,
      body: response.body,
      contentType: response.contentType,
      provenance: {
        url,
        fetchedAt: fetchedAt.toISOString(),
        sha256: sha256(response.body),
        sourceId,
        sourceVersion: policy.version,
        tierUsed: response.tierUsed,
        costDollars: response.costDollars,
      },
    };
  }

  return { fetchSource };
}
