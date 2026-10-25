// The public status page's incident log (#769, part 1 of #96): `incident` and `incident_update` are
// platform tables (GLOBAL_TABLES, no `workspace_id`, no RLS). They hold only the text staff publish
// on the public status page about platform components: a title, a severity, a state and update
// messages. They never reference a workspace, matter, document or person, and the snapshot
// sanitiser (`@causedeck/core/status`) projects only these public fields. Written by the staff
// incident console (#770); the app role may SELECT, INSERT and UPDATE them, never DELETE.
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';

export const INCIDENT_SEVERITIES = ['degraded', 'down'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

export const incident = pgTable(
  'incident',
  {
    id: id(),
    /** Public headline, shown as written. */
    title: text('title').notNull(),
    severity: text('severity').$type<IncidentSeverity>().notNull(),
    state: text('state').$type<IncidentState>().notNull().default('investigating'),
    /** The status component affected (`court`, `api`, ...); a public key, not a foreign key. */
    component: text('component').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** The staff user who opened it (#770 audits the action); no foreign key, platform data only. */
    createdBy: uuid('created_by'),
    ...timestamps(),
  },
  (t) => [
    index('incident_started_at_idx').on(t.startedAt),
    check('incident_title_chk', sql`btrim(title) <> ''`),
    check('incident_severity_chk', sql`severity in ('degraded', 'down')`),
    check(
      'incident_state_chk',
      sql`state in ('investigating', 'identified', 'monitoring', 'resolved')`,
    ),
    check('incident_resolved_chk', sql`(state = 'resolved') = (resolved_at is not null)`),
  ],
);

export const incidentUpdate = pgTable(
  'incident_update',
  {
    id: id(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    state: text('state').$type<IncidentState>().notNull(),
    body: text('body').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('incident_update_incident_id_idx').on(t.incidentId, t.createdAt),
    check('incident_update_body_chk', sql`btrim(body) <> ''`),
    check(
      'incident_update_state_chk',
      sql`state in ('investigating', 'identified', 'monitoring', 'resolved')`,
    ),
  ],
);
