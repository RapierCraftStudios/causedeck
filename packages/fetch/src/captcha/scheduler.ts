// The bulk captcha scheduler (#492, D-048). Dark: nothing enqueues it yet, and every job is gated
// by `bulkCaptchaGate` (registry clearance + approval reference + kill switches) on every dispatch.
// Per-host rate and concurrency budgets, an off-peak window, crawl priority (what users track, then
// the launch courts, then backfill), the ETag/hash page cache, block and error alarms, and a
// backoff to zero traffic after repeated blocks. Time is injected; `tick()` is the unit of work,
// `start()` just calls it on an interval (default 15 s, so a kill switch bites well inside a minute).
import { detectBlockSignature } from '../block-signature.ts';
import type { Fetcher } from '../fetcher.ts';
import { createRateLimiter } from '../rate-limit.ts';
import {
  FetchDenied,
  type FetchClock,
  type FetchHealth,
  type FetchRegistry,
  type FetchResult,
} from '../types.ts';

import { createPageCache, type PageCache } from './cache.ts';
import { bulkCaptchaGate, type BulkCaptchaDenial, type BulkKillSwitches } from './gate.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export const CRAWL_PRIORITIES = ['tracked', 'launch', 'backfill'] as const;
export type CrawlPriority = (typeof CRAWL_PRIORITIES)[number];

export interface BulkJob {
  sourceId: string;
  url: string;
  priority: CrawlPriority;
  /** Overrides the scheduler's page freshness window for this job. */
  freshnessMs?: number;
}

export interface PageResponse {
  status: number;
  body: string;
  contentType: string;
  /** The source's ETag when the transport exposes response headers. */
  etag?: string | null;
  /** The source answered 304 to `ifNoneMatch`. */
  notModified?: boolean;
}

/** One page read; `ifNoneMatch` is the cached ETag, for transports that can send it. */
export type PageSource = (
  sourceId: string,
  url: string,
  validators: { ifNoneMatch?: string },
) => Promise<PageResponse>;

/** The governed fetcher as a page source (it exposes no headers, so freshness is by hash). */
export function pageSourceFromFetcher(fetcher: Fetcher): PageSource {
  return async (sourceId, url) => {
    const result: FetchResult = await fetcher.fetchSource(sourceId, url);
    return { status: result.status, body: result.body, contentType: result.contentType };
  };
}

export type BulkAlert =
  | { kind: 'block'; host: string; sourceId: string; signature: string; at: Date }
  | { kind: 'error'; host: string; sourceId: string; consecutive: number; at: Date }
  | { kind: 'host_backoff'; host: string; until: Date; reason: 'blocks' | 'errors'; at: Date };

export interface BulkAlertSink {
  alert(event: BulkAlert): Promise<void> | void;
}

/** Off-peak window as local hours; the default is 19:00-07:00 IST, outside court working hours. */
export interface OffPeakWindow {
  startHour: number;
  endHour: number;
  utcOffsetMinutes: number;
}
export const DEFAULT_OFF_PEAK: OffPeakWindow = { startHour: 19, endHour: 7, utcOffsetMinutes: 330 };

export function isOffPeak(at: Date, window: OffPeakWindow): boolean {
  const local = new Date(at.getTime() + window.utcOffsetMinutes * MINUTE_MS);
  const hour = local.getUTCHours();
  return window.startHour <= window.endHour
    ? hour >= window.startHour && hour < window.endHour
    : hour >= window.startHour || hour < window.endHour;
}

export interface BulkSchedulerConfig {
  /** Requests per minute per host, across sources. Default 6. */
  hostRequestsPerMinute?: number;
  /** In-flight requests per host. Default 1. */
  hostConcurrency?: number;
  offPeak?: OffPeakWindow | null;
  /** Page freshness window. Default 6 h. */
  freshnessMs?: number;
  /** Consecutive blocks that trip a host to zero traffic. Default 3. */
  blockTripThreshold?: number;
  /** Consecutive errors that alarm, and (doubled) back the host off. Default 5. */
  errorAlarmThreshold?: number;
  /** First backoff; doubles with each trip. Default 1 h, capped at `backoffMaxMs` (default 24 h). */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Queue bound. Default 50 000; the lowest priority is refused first when full. */
  maxQueue?: number;
}

export interface BulkSchedulerDeps {
  registry: FetchRegistry;
  pages: PageSource;
  clock: FetchClock;
  kill: BulkKillSwitches;
  alerts: BulkAlertSink;
  /** The data-ops evaluator port (#515): a block signature is also reported here. */
  health?: FetchHealth;
  cache?: PageCache;
  config?: BulkSchedulerConfig;
}

export type JobDisposition =
  'fetched' | 'unchanged' | 'cached' | 'blocked' | 'failed' | 'denied_gate' | 'dropped_killed';

export interface JobReport {
  job: BulkJob;
  disposition: JobDisposition;
  denial?: BulkCaptchaDenial | 'source_not_cleared';
}

export interface TickReport {
  offPeak: boolean;
  jobs: JobReport[];
  /** Jobs left queued (budget, backoff or off-peak). */
  pending: number;
}

export interface BulkScheduler {
  enqueue(job: BulkJob): 'queued' | 'duplicate' | 'queue_full';
  tick(): Promise<TickReport>;
  start(intervalMs?: number): () => void;
  pending(): number;
  hostBackedOffUntil(host: string): Date | null;
}

interface HostState {
  inFlight: number;
  blocks: number;
  errors: number;
  trips: number;
  backoffUntil: number;
}

interface Queued {
  job: BulkJob;
  host: string;
  seq: number;
}

export function createBulkScheduler(deps: BulkSchedulerDeps): BulkScheduler {
  const cfg = deps.config ?? {};
  const perMinute = cfg.hostRequestsPerMinute ?? 6;
  const concurrency = cfg.hostConcurrency ?? 1;
  const offPeak = cfg.offPeak === undefined ? DEFAULT_OFF_PEAK : cfg.offPeak;
  const blockTrip = cfg.blockTripThreshold ?? 3;
  const errorAlarm = cfg.errorAlarmThreshold ?? 5;
  const backoffBase = cfg.backoffBaseMs ?? HOUR_MS;
  const backoffMax = cfg.backoffMaxMs ?? 24 * HOUR_MS;
  const maxQueue = cfg.maxQueue ?? 50_000;
  const nowMs = (): number => deps.clock.now().getTime();
  const cache =
    deps.cache ??
    createPageCache({
      now: nowMs,
      ...(cfg.freshnessMs === undefined ? {} : { freshnessMs: cfg.freshnessMs }),
    });
  const limiter = createRateLimiter(nowMs);

  let queue: Queued[] = [];
  const queued = new Set<string>();
  const hosts = new Map<string, HostState>();
  let seq = 0;

  const hostOf = (url: string): string => new URL(url).host;
  const jobKey = (job: BulkJob): string => `${job.sourceId}|${job.url}`;
  const state = (host: string): HostState => {
    let s = hosts.get(host);
    if (s === undefined) {
      s = { inFlight: 0, blocks: 0, errors: 0, trips: 0, backoffUntil: 0 };
      hosts.set(host, s);
    }
    return s;
  };
  const safeAlert = async (event: BulkAlert): Promise<void> => {
    try {
      await deps.alerts.alert(event);
    } catch {
      // An alarm sink failure never fails or retries a fetch.
    }
  };

  async function trip(host: string, reason: 'blocks' | 'errors'): Promise<void> {
    const s = state(host);
    const wait = Math.min(backoffBase * 2 ** s.trips, backoffMax);
    s.trips += 1;
    s.backoffUntil = nowMs() + wait;
    s.blocks = 0;
    s.errors = 0;
    await safeAlert({
      kind: 'host_backoff',
      host,
      until: new Date(s.backoffUntil),
      reason,
      at: deps.clock.now(),
    });
  }

  async function run(entry: Queued, report: JobReport[]): Promise<void> {
    const { job, host } = entry;
    const s = state(host);
    s.inFlight += 1;
    try {
      // Re-check the kill switches right before the call: a flip mid-tick stops this job.
      if (deps.kill.global() || deps.kill.host(host)) {
        report.push({ job, disposition: 'dropped_killed' });
        return;
      }
      const cached = cache.lookup(job.url);
      let ifNoneMatch: string | undefined;
      if (cached.state === 'stale' && cached.entry.etag !== null) ifNoneMatch = cached.entry.etag;
      let response: PageResponse;
      try {
        response = await deps.pages(
          job.sourceId,
          job.url,
          ifNoneMatch === undefined ? {} : { ifNoneMatch },
        );
      } catch (cause) {
        if (cause instanceof FetchDenied) {
          // The governed fetcher's own limits: try again later, not an error against the host.
          requeue(entry);
          return;
        }
        s.errors += 1;
        report.push({ job, disposition: 'failed' });
        await onError(job, host, s);
        return;
      }

      const at = deps.clock.now();
      const signature =
        response.notModified === true
          ? null
          : detectBlockSignature(response.status, response.body, response.contentType);
      if (signature !== null) {
        s.blocks += 1;
        await safeAlert({ kind: 'block', host, sourceId: job.sourceId, signature, at });
        if (deps.health?.reportBlock !== undefined) {
          await deps.health
            .reportBlock({ sourceId: job.sourceId, signature, at })
            .catch(() => undefined);
        }
        report.push({ job, disposition: 'blocked' });
        if (s.blocks >= blockTrip) await trip(host, 'blocks');
        return;
      }
      if (response.notModified === true) {
        cache.touch(job.url, job.freshnessMs);
        s.blocks = 0;
        s.errors = 0;
        report.push({ job, disposition: 'unchanged' });
        return;
      }
      if (response.status >= 500 || response.status === 0) {
        s.errors += 1;
        report.push({ job, disposition: 'failed' });
        await onError(job, host, s);
        return;
      }
      const stored = cache.store(
        job.url,
        {
          status: response.status,
          body: response.body,
          contentType: response.contentType,
          etag: response.etag ?? null,
        },
        job.freshnessMs,
      );
      s.blocks = 0;
      s.errors = 0;
      s.trips = 0;
      report.push({ job, disposition: stored.changed ? 'fetched' : 'unchanged' });
    } finally {
      s.inFlight -= 1;
    }
  }

  async function onError(job: BulkJob, host: string, s: HostState): Promise<void> {
    if (s.errors >= errorAlarm) {
      await safeAlert({
        kind: 'error',
        host,
        sourceId: job.sourceId,
        consecutive: s.errors,
        at: deps.clock.now(),
      });
    }
    if (s.errors >= errorAlarm * 2) await trip(host, 'errors');
  }

  function requeue(entry: Queued): void {
    queue.push(entry);
  }

  const rank = (p: CrawlPriority): number => CRAWL_PRIORITIES.indexOf(p);

  return {
    enqueue(job) {
      const key = jobKey(job);
      if (queued.has(key)) return 'duplicate';
      if (queue.length >= maxQueue) return 'queue_full';
      queued.add(key);
      queue.push({ job, host: hostOf(job.url), seq: (seq += 1) });
      return 'queued';
    },

    pending: () => queue.length,

    hostBackedOffUntil(host) {
      const until = hosts.get(host)?.backoffUntil ?? 0;
      return until > nowMs() ? new Date(until) : null;
    },

    async tick() {
      const jobs: JobReport[] = [];
      const at = deps.clock.now();
      const inWindow = offPeak === null || isOffPeak(at, offPeak);

      // Kill switches drop the queued jobs they cover (a global kill stops everything, a host kill that host).
      const globalKill = deps.kill.global();
      const killedHosts = new Map<string, boolean>();
      const hostKilled = (host: string): boolean => {
        let k = killedHosts.get(host);
        if (k === undefined) {
          k = deps.kill.host(host);
          killedHosts.set(host, k);
        }
        return k;
      };
      const keep: Queued[] = [];
      for (const entry of queue) {
        if (globalKill || hostKilled(entry.host)) {
          queued.delete(jobKey(entry.job));
          jobs.push({ job: entry.job, disposition: 'dropped_killed' });
        } else keep.push(entry);
      }
      queue = keep;
      if (!inWindow) return { offPeak: false, jobs, pending: queue.length };

      queue.sort((a, b) => rank(a.job.priority) - rank(b.job.priority) || a.seq - b.seq);
      const remaining: Queued[] = [];
      const running: Promise<void>[] = [];

      for (const entry of queue) {
        const { job, host } = entry;
        const s = state(host);
        if (s.backoffUntil > nowMs()) {
          remaining.push(entry);
          continue;
        }
        // The gate, on every dispatch: the registry row is read fresh each time.
        let denial: BulkCaptchaDenial | 'source_not_cleared' | null = null;
        try {
          const policy = await deps.registry.policyFor(job.sourceId);
          denial = bulkCaptchaGate(policy, host, deps.kill);
        } catch {
          denial = 'source_not_cleared';
        }
        if (denial !== null) {
          queued.delete(jobKey(job));
          jobs.push({ job, disposition: 'denied_gate', denial });
          continue;
        }
        const hit = cache.lookup(job.url);
        if (hit.state === 'fresh') {
          queued.delete(jobKey(job));
          jobs.push({ job, disposition: 'cached' });
          continue;
        }
        if (
          s.inFlight >= concurrency ||
          !limiter.tryAcquire(`host:${host}`, perMinute, MINUTE_MS)
        ) {
          remaining.push(entry);
          continue;
        }
        queued.delete(jobKey(job));
        // `run` takes its in-flight slot synchronously, before this loop reaches the next job.
        running.push(run(entry, jobs));
      }
      queue = remaining;
      await Promise.all(running);
      // A requeued (denied by the fetcher) job is queued again; keep its key registered.
      for (const entry of queue) queued.add(jobKey(entry.job));
      return { offPeak: true, jobs, pending: queue.length };
    },

    start(intervalMs = 15_000) {
      let busy = false;
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        void this.tick().finally(() => {
          busy = false;
        });
      }, intervalMs);
      return () => {
        clearInterval(timer);
      };
    },
  };
}
