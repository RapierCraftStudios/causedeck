// Building, signing and publishing the status snapshot (#769, part 1 of #96).
//
// Sources: injected readiness checks (database, storage), `getAdapterHealthSummary` for the court
// parsing component, and the platform `incident` tables. Everything public goes through
// `sanitiseIncident`/`componentFromCheck`, an allowlist projection: free text from errors, hostnames
// and workspace data never reach the snapshot.
//
// Thresholds (documented here, tested in status.test.ts). An adapter with fewer than
// `MIN_RUNS_FOR_STATUS` parse runs is `operational` (too little signal). Otherwise
//   failed share >= `DOWN_FAILED_SHARE` (50%)                     -> down
//   (failed + degraded) share >= `DEGRADED_SHARE` (20%)           -> degraded
//   else                                                          -> operational
// The court component is the worst of its adapters. A failing readiness check is `down`.
//
// Publishing is idempotent: the snapshot is rewritten only when its content (ignoring
// `generatedAt`) changed or the published one is older than `REPUBLISH_AFTER_SEC`; readers treat a
// snapshot older than `STALE_AFTER_SEC` as stale (`isStale`).
import { createHmac, timingSafeEqual } from 'node:crypto';

import { schema, type Queryable } from '@causedeck/db';
import { ObjectNotFoundError, publicObjectKey, type ObjectStore } from '@causedeck/storage';
import { desc, gte, inArray } from 'drizzle-orm';

import { getAdapterHealthSummary, type AdapterHealthSummaryRow } from '../court/index.ts';

import {
  COMPONENT_STATES,
  statusSnapshotSchema,
  type ComponentId,
  type ComponentState,
  type ComponentStatus,
  type Incident,
  type StatusSnapshot,
  type UnsignedStatusSnapshot,
} from './model.ts';

export const MIN_RUNS_FOR_STATUS = 5;
export const DEGRADED_SHARE = 0.2;
export const DOWN_FAILED_SHARE = 0.5;
export const REPUBLISH_AFTER_SEC = 180;
export const STALE_AFTER_SEC = 300;
/** Resolved incidents stay on the feed this long. */
export const INCIDENT_WINDOW_DAYS = 30;
export const STATUS_OBJECT_PATH = 'status/status.json';
/** Public wording of the court component (the parsing of documents a user shares). */
export const COURT_COMPONENT_NAME = 'Parsing of documents you share';

const COMPONENT_NAMES: Record<Exclude<ComponentId, 'court'>, string> = {
  database: 'Sign-in and matters',
  storage: 'Document storage',
};

/** Worse state wins. */
export function worstState(states: readonly ComponentState[]): ComponentState {
  let worst = 0;
  for (const state of states) worst = Math.max(worst, COMPONENT_STATES.indexOf(state));
  return COMPONENT_STATES[worst] ?? 'operational';
}

/** One adapter's parse runs mapped to a component state (thresholds above). */
export function adapterState(
  row: Pick<AdapterHealthSummaryRow, 'runs' | 'degradedRuns' | 'failedRuns'>,
): ComponentState {
  if (row.runs < MIN_RUNS_FOR_STATUS) return 'operational';
  if (row.failedRuns / row.runs >= DOWN_FAILED_SHARE) return 'down';
  if ((row.failedRuns + row.degradedRuns) / row.runs >= DEGRADED_SHARE) return 'degraded';
  return 'operational';
}

/** Adapter versions are summed per adapter before mapping; the adapter ids never leave here. */
export function courtState(rows: readonly AdapterHealthSummaryRow[]): ComponentState {
  const byAdapter = new Map<string, { runs: number; degradedRuns: number; failedRuns: number }>();
  for (const row of rows) {
    const sum = byAdapter.get(row.adapterId) ?? { runs: 0, degradedRuns: 0, failedRuns: 0 };
    sum.runs += row.runs;
    sum.degradedRuns += row.degradedRuns;
    sum.failedRuns += row.failedRuns;
    byAdapter.set(row.adapterId, sum);
  }
  return worstState([...byAdapter.values()].map(adapterState));
}

/** Strip control characters and collapse whitespace; public text is one trimmed line or paragraph. */
function cleanText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : '';
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .trim()
      .slice(0, max)
  );
}

const iso = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

/**
 * Project a raw incident row (with its update rows) to the public shape. Unknown fields (author,
 * workspace ids, anything a caller attaches) are dropped; a row that is not publishable returns null.
 */
export function sanitiseIncident(
  raw: unknown,
  rawUpdates: readonly unknown[] = [],
): Incident | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const startedAt = iso(row.startedAt);
  const title = cleanText(row.title, 200);
  const component = cleanText(row.component, 40);
  const state = row.state as Incident['state'];
  const severity = row.severity as Incident['severity'];
  if (startedAt === null || title === '' || component === '' || typeof row.id !== 'string') {
    return null;
  }
  const updates: Incident['updates'] = [];
  for (const item of rawUpdates) {
    const update = (item ?? {}) as Record<string, unknown>;
    const at = iso(update.createdAt);
    const body = cleanText(update.body, 2000);
    if (at === null || body === '') continue;
    updates.push({ state: update.state as Incident['updates'][number]['state'], body, at });
  }
  updates.sort((a, b) => a.at.localeCompare(b.at));
  const candidate = {
    id: row.id,
    title,
    severity,
    state,
    component,
    startedAt,
    resolvedAt: iso(row.resolvedAt),
    updates,
  };
  const parsed = statusSnapshotSchema.shape.incidents.element.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export interface StatusCheck {
  id: Exclude<ComponentId, 'court'>;
  /** Rejects when the dependency is unreachable; the message is never published. */
  check: () => Promise<void>;
}

export interface BuildSnapshotDeps {
  db: Queryable;
  checks: readonly StatusCheck[];
  now?: () => Date;
  /** Readiness checks are abandoned after this long and count as `down`. */
  checkTimeoutMs?: number;
}

async function runCheck(check: StatusCheck, timeoutMs: number): Promise<ComponentStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check.check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'));
        }, timeoutMs);
      }),
    ]);
    return { id: check.id, name: COMPONENT_NAMES[check.id], status: 'operational' };
  } catch {
    return { id: check.id, name: COMPONENT_NAMES[check.id], status: 'down' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function loadIncidents(db: Queryable, now: Date): Promise<Incident[]> {
  const since = new Date(now.getTime() - INCIDENT_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select()
    .from(schema.incident)
    .where(gte(schema.incident.startedAt, since))
    .orderBy(desc(schema.incident.startedAt))
    .limit(50);
  if (rows.length === 0) return [];
  const updates = await db
    .select()
    .from(schema.incidentUpdate)
    .where(
      inArray(
        schema.incidentUpdate.incidentId,
        rows.map((r) => r.id),
      ),
    );
  return rows
    .map((row) =>
      sanitiseIncident(
        row,
        updates.filter((u) => u.incidentId === row.id),
      ),
    )
    .filter((incident): incident is Incident => incident !== null);
}

/** Build the unsigned snapshot from the checks, the adapter summary and the incident log. */
export async function buildSnapshot(deps: BuildSnapshotDeps): Promise<UnsignedStatusSnapshot> {
  const now = (deps.now ?? (() => new Date()))();
  const timeout = deps.checkTimeoutMs ?? 2000;
  const checked = await Promise.all(deps.checks.map((check) => runCheck(check, timeout)));
  const court: ComponentStatus = {
    id: 'court',
    name: COURT_COMPONENT_NAME,
    status: courtState(await getAdapterHealthSummary(deps.db)),
  };
  const components = [...checked, court];
  const incidents = await loadIncidents(deps.db, now);
  const open = incidents.filter((i) => i.state !== 'resolved').map((i) => i.severity);
  return {
    version: 1,
    generatedAt: now.toISOString(),
    overall: worstState([...components.map((c) => c.status), ...open]),
    components,
    incidents,
  };
}

/** JSON with object keys sorted at every level: the same value always gives the same bytes. */
export function canonicalStatusJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStatusJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStatusJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hmac(unsigned: UnsignedStatusSnapshot, key: string): string {
  return createHmac('sha256', key).update(canonicalStatusJson(unsigned)).digest('hex');
}

export function signSnapshot(unsigned: UnsignedStatusSnapshot, key: string): StatusSnapshot {
  return { ...unsigned, signature: { alg: 'HS256', value: hmac(unsigned, key) } };
}

/** True when the snapshot parses and its signature matches `key` (constant-time compare). */
export function verifySnapshot(snapshot: unknown, key: string): boolean {
  const parsed = statusSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) return false;
  const { signature, ...unsigned } = parsed.data;
  const expected = Buffer.from(hmac(unsigned, key), 'hex');
  const actual = Buffer.from(signature.value, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A snapshot older than `maxAgeSec` (or dated in an unreadable way) is stale. */
export function isStale(
  snapshot: Pick<StatusSnapshot, 'generatedAt'>,
  now: Date,
  maxAgeSec: number = STALE_AFTER_SEC,
): boolean {
  const at = Date.parse(snapshot.generatedAt);
  return Number.isNaN(at) || now.getTime() - at > maxAgeSec * 1000;
}

export interface PublishStatusDeps extends BuildSnapshotDeps {
  store: Pick<ObjectStore, 'put' | 'get'>;
  signingKey: string;
}

export interface PublishStatusResult {
  published: boolean;
  reason: 'first' | 'changed' | 'refresh' | 'unchanged';
  snapshot: StatusSnapshot;
}

async function readPublished(
  store: Pick<ObjectStore, 'get'>,
  key: string,
): Promise<StatusSnapshot | null> {
  try {
    const stored = await store.get(publicObjectKey(STATUS_OBJECT_PATH));
    const parsed = statusSnapshotSchema.safeParse(
      JSON.parse(new TextDecoder().decode(stored.body)),
    );
    return parsed.success && verifySnapshot(parsed.data, key) ? parsed.data : null;
  } catch (error) {
    if (error instanceof ObjectNotFoundError || error instanceof SyntaxError) return null;
    throw error;
  }
}

const contentOf = (snapshot: UnsignedStatusSnapshot): string =>
  canonicalStatusJson({ ...snapshot, generatedAt: null });

const withoutSignature = (s: StatusSnapshot): UnsignedStatusSnapshot => ({
  version: s.version,
  generatedAt: s.generatedAt,
  overall: s.overall,
  components: s.components,
  incidents: s.incidents,
});

/** Build, sign and write `status/status.json` unless the published one is still current. */
export async function publishStatus(deps: PublishStatusDeps): Promise<PublishStatusResult> {
  const now = (deps.now ?? (() => new Date()))();
  const snapshot = signSnapshot(await buildSnapshot({ ...deps, now: () => now }), deps.signingKey);
  const current = await readPublished(deps.store, deps.signingKey);
  let reason: PublishStatusResult['reason'] = 'first';
  if (current !== null) {
    if (contentOf(withoutSignature(current)) !== contentOf(withoutSignature(snapshot)))
      reason = 'changed';
    else if (isStale(current, now, REPUBLISH_AFTER_SEC)) reason = 'refresh';
    else return { published: false, reason: 'unchanged', snapshot: current };
  }
  await deps.store.put({
    key: publicObjectKey(STATUS_OBJECT_PATH),
    body: new TextEncoder().encode(JSON.stringify(snapshot)),
    contentType: 'application/json',
  });
  return { published: true, reason, snapshot };
}
