// Browser-safe mirror of the public status snapshot (`packages/core/src/status/model.ts`, #769).
// The site cannot import `@causedeck/core` (node:crypto, db, storage), so the shape is copied here;
// `status.test.ts` pins a snapshot signed by core's algorithm so the two cannot drift silently.
export const COMPONENT_STATES = ['operational', 'degraded', 'down'] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

export const INCIDENT_STATES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

export const COMPONENT_IDS = ['database', 'storage', 'court'] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

/** A snapshot older than this is shown with a warning (core `STALE_AFTER_SEC`). */
export const STALE_AFTER_SEC = 300;
/** Days the uptime strip and the history page cover (core `INCIDENT_WINDOW_DAYS`). */
export const INCIDENT_WINDOW_DAYS = 30;

/** Court wording is fixed by policy: the page never says "eCourts" or names a court system. */
export const COMPONENT_LABELS: Record<ComponentId, string> = {
  database: 'Application and data',
  storage: 'Document storage',
  court: 'Parsing of documents you share',
};

export interface StatusIncidentUpdate {
  state: IncidentState;
  body: string;
  at: string;
}

export interface StatusIncident {
  id: string;
  title: string;
  severity: 'degraded' | 'down';
  state: IncidentState;
  component: string;
  startedAt: string;
  resolvedAt: string | null;
  updates: StatusIncidentUpdate[];
}

export interface UnsignedStatusSnapshot {
  version: 1;
  generatedAt: string;
  overall: ComponentState;
  components: { id: ComponentId; name: string; status: ComponentState }[];
  incidents: StatusIncident[];
}

export interface StatusSnapshot extends UnsignedStatusSnapshot {
  signature: { alg: 'HS256'; value: string };
}

// Hand-written validation: zod would add ~tens of KB of script to the statically exported /status/
// page, which must stay inside the site's script budget. It matches core's schema and, like it,
// returns a copy with unknown keys dropped (the signature covers exactly those fields).
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isIso = (v: unknown): v is string =>
  typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseIncident(raw: unknown): StatusIncident | null {
  if (!isRec(raw) || !Array.isArray(raw.updates)) return null;
  const updates: StatusIncidentUpdate[] = [];
  for (const u of raw.updates as unknown[]) {
    if (!isRec(u) || !isOneOf(INCIDENT_STATES, u.state) || !isStr(u.body, 1, 2000)) return null;
    if (!isIso(u.at)) return null;
    updates.push({ state: u.state, body: u.body, at: u.at });
  }
  const { id, title, severity, state, component, startedAt, resolvedAt } = raw;
  if (typeof id !== 'string' || !UUID.test(id) || !isStr(title, 1, 200)) return null;
  if (!isOneOf(['degraded', 'down'] as const, severity) || !isOneOf(INCIDENT_STATES, state)) {
    return null;
  }
  if (!isStr(component, 1, 40) || !isIso(startedAt)) return null;
  if (resolvedAt !== null && !isIso(resolvedAt)) return null;
  return { id, title, severity, state, component, startedAt, resolvedAt, updates };
}

/** The validated snapshot (unknown keys dropped), or null when `raw` does not match the shape. */
export function parseStatusSnapshot(raw: unknown): StatusSnapshot | null {
  if (!isRec(raw) || raw.version !== 1 || !isIso(raw.generatedAt)) return null;
  if (!isOneOf(COMPONENT_STATES, raw.overall)) return null;
  if (!Array.isArray(raw.components) || !Array.isArray(raw.incidents)) return null;
  const components: UnsignedStatusSnapshot['components'] = [];
  for (const c of raw.components as unknown[]) {
    if (!isRec(c) || !isOneOf(COMPONENT_IDS, c.id) || !isStr(c.name, 1, 80)) return null;
    if (!isOneOf(COMPONENT_STATES, c.status)) return null;
    components.push({ id: c.id, name: c.name, status: c.status });
  }
  const incidents: StatusIncident[] = [];
  for (const i of raw.incidents as unknown[]) {
    const incident = parseIncident(i);
    if (incident === null) return null;
    incidents.push(incident);
  }
  const sig = raw.signature;
  if (!isRec(sig) || sig.alg !== 'HS256') return null;
  if (typeof sig.value !== 'string' || !/^[0-9a-f]{64}$/.test(sig.value)) return null;
  return {
    version: 1,
    generatedAt: raw.generatedAt,
    overall: raw.overall,
    components,
    incidents,
    signature: { alg: 'HS256', value: sig.value },
  };
}
