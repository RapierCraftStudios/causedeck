// Performance budgets (#105; spike §3.2 and §10, PRD §8). The single source for the k6 thresholds,
// the Lighthouse assertions, the bundle budget and the Stage A to B triggers. Plain TypeScript with
// no k6 imports so vitest and the Node scripts can load it.

export const BUDGETS = {
  /** p95 of a server action, ms. A run fails at or above it. */
  actionP95Ms: 300,
  /** p95 of any read route, ms. */
  readP95Ms: 400,
  /** Court-day board data from the cache path, p95 ms. */
  courtDayCacheP95Ms: 300,
  /** Inbox route server render with 200 items, p95 ms (#48 R16c). */
  inboxP95Ms: 300,
  /** Brief assembly per listing, p95 ms. */
  briefAssemblyP95Ms: 5000,
  /** Failed-request rate; a run fails at or above it. */
  errorRate: 0.005,
  /** Initial JS of the court-day route, gzip bytes. */
  courtDayJsBytes: 180 * 1024,
  /** Lighthouse performance and accessibility minimum score (0..1). */
  lighthouseScore: 0.95,
  /** Cold start on the 4 GB Android-class profile, ms. */
  coldStartMs: 2500,
  /** A p95 regression above this fraction against the previous nightly opens an issue. */
  regressionFraction: 0.15,
} as const;

/** Stage A to B triggers (spike §3.2): any one of them moves Postgres to its own box. */
export const STAGE_B_TRIGGERS = {
  p95Ms: 400,
  dbCpuPercent: 60,
  seats: 1000,
} as const;

/** Route groups the scenarios tag requests with (`group` tag). */
export const ROUTE_GROUPS = [
  'action',
  'read',
  'court_day_cache',
  'inbox',
  'brief_assembly',
] as const;
export type RouteGroup = (typeof ROUTE_GROUPS)[number];

/** k6 `options.thresholds`: `p(95)<N` fails the run at N or above. */
export function k6Thresholds(): Record<string, string[]> {
  return {
    'http_req_duration{group:action}': [`p(95)<${String(BUDGETS.actionP95Ms)}`],
    'http_req_duration{group:read}': [`p(95)<${String(BUDGETS.readP95Ms)}`],
    'http_req_duration{group:court_day_cache}': [`p(95)<${String(BUDGETS.courtDayCacheP95Ms)}`],
    'http_req_duration{group:inbox}': [`p(95)<${String(BUDGETS.inboxP95Ms)}`],
    'http_req_duration{group:brief_assembly}': [`p(95)<${String(BUDGETS.briefAssemblyP95Ms)}`],
    http_req_failed: [`rate<${String(BUDGETS.errorRate)}`],
    // Any readiness poll that fails counts as a flap.
    readiness_flaps: ['count<1'],
    // A cross-tenant probe that returns anything but 403 or 404 fails the run.
    cross_tenant_leaks: ['count<1'],
  };
}

/** The Lighthouse assertions shared by every profile. */
export function lighthouseAssertions(): Record<string, [string, Record<string, number>]> {
  return {
    'categories:performance': ['error', { minScore: BUDGETS.lighthouseScore }],
    'categories:accessibility': ['error', { minScore: BUDGETS.lighthouseScore }],
    interactive: ['error', { maxNumericValue: BUDGETS.coldStartMs }],
  };
}

/**
 * `lhci autorun` flags that turn `lighthouse/lighthouserc.json` (mobile) into the throttled 4 GB
 * Android-class profile: 4x CPU slowdown, a slow 4G network. LHCI takes one settings block per
 * config, so the second profile is flags on top of the same file.
 */
export const ANDROID_PROFILE_FLAGS = [
  '--collect.settings.throttlingMethod=simulate',
  '--collect.settings.throttling.cpuSlowdownMultiplier=4',
  '--collect.settings.throttling.rttMs=150',
  '--collect.settings.throttling.throughputKbps=1638.4',
  '--upload.outputDir=.lighthouseci/perf-android',
] as const;
