// Browser-safe mirror of the public status snapshot (`packages/core/src/status/model.ts`, #769).
// The site cannot import `@causedeck/core` (node:crypto, db, storage), so the schema is copied here;
// `status.test.ts` pins a snapshot signed by core's algorithm so the two cannot drift silently.
import { z } from 'zod';

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

const incidentUpdateSchema = z.object({
  state: z.enum(INCIDENT_STATES),
  body: z.string().min(1).max(2000),
  at: z.iso.datetime(),
});

const incidentSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  severity: z.enum(['degraded', 'down']),
  state: z.enum(INCIDENT_STATES),
  component: z.string().min(1).max(40),
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  updates: z.array(incidentUpdateSchema),
});

export const unsignedSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  overall: z.enum(COMPONENT_STATES),
  components: z.array(
    z.object({
      id: z.enum(COMPONENT_IDS),
      name: z.string().min(1).max(80),
      status: z.enum(COMPONENT_STATES),
    }),
  ),
  incidents: z.array(incidentSchema),
});

export const statusSnapshotSchema = unsignedSnapshotSchema.extend({
  signature: z.object({ alg: z.literal('HS256'), value: z.string().regex(/^[0-9a-f]{64}$/) }),
});

export type UnsignedStatusSnapshot = z.infer<typeof unsignedSnapshotSchema>;
export type StatusSnapshot = z.infer<typeof statusSnapshotSchema>;
export type StatusIncident = StatusSnapshot['incidents'][number];
