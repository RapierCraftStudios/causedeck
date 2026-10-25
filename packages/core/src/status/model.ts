// The public status snapshot (#769, part 1 of #96): the one document `status/status.json` carries.
// It names platform components and incidents only, never a workspace, matter, document or person;
// `publish.ts` builds it from an allowlist and signs it with HMAC-SHA256 so a reader can verify it.
import { z } from 'zod';

export const COMPONENT_STATES = ['operational', 'degraded', 'down'] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];
export const componentState = z.enum(COMPONENT_STATES);

export const INCIDENT_STATES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

/** Component keys are public identifiers, also the keys of the `status` i18n namespace. */
export const COMPONENT_IDS = ['database', 'storage', 'court'] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

export const componentStatusSchema = z.object({
  id: z.enum(COMPONENT_IDS),
  /** English display name; the page localises by `id`. */
  name: z.string().min(1).max(80),
  status: componentState,
});
export type ComponentStatus = z.infer<typeof componentStatusSchema>;

export const incidentUpdateSchema = z.object({
  state: z.enum(INCIDENT_STATES),
  body: z.string().min(1).max(2000),
  at: z.iso.datetime(),
});
export type IncidentUpdate = z.infer<typeof incidentUpdateSchema>;

export const incidentSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  severity: z.enum(['degraded', 'down']),
  state: z.enum(INCIDENT_STATES),
  component: z.string().min(1).max(40),
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  updates: z.array(incidentUpdateSchema),
});
export type Incident = z.infer<typeof incidentSchema>;

/** The snapshot without its signature: the bytes the HMAC covers (canonical JSON). */
export const unsignedSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  /** The worst component state, or `down` for an open `down` incident. */
  overall: componentState,
  components: z.array(componentStatusSchema),
  incidents: z.array(incidentSchema),
});
export type UnsignedStatusSnapshot = z.infer<typeof unsignedSnapshotSchema>;

export const statusSnapshotSchema = unsignedSnapshotSchema.extend({
  signature: z.object({
    alg: z.literal('HS256'),
    /** Lowercase hex HMAC-SHA256 of the canonical JSON of the unsigned snapshot. */
    value: z.string().regex(/^[0-9a-f]{64}$/),
  }),
});
export type StatusSnapshot = z.infer<typeof statusSnapshotSchema>;
