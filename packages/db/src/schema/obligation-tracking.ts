// The obligation service's own tables (#67; ADR 0037): `obligation_event` (the history of an
// obligation: creation, reschedules with their reason, closure, reopening, defect and copy steps),
// `defect` (a registry defect with its cure deadline) and `certified_copy` (applied -> ready ->
// collected). Each hangs off an `obligation` row, which stays the one queue item; tenant tables
// under FORCE RLS via `tenantTable()`. Children cascade with their obligation. The event's actor is
// a bare member id: the log outlives the member, so there is no FK to clear on account deletion.
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id, provenance, provenanceCheck, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';
import { anchor } from './documents.ts';
import { obligation } from './docket.ts';
import { proceeding } from './proceedings.ts';

export const OBLIGATION_EVENT_KINDS = [
  'created',
  'updated',
  'rescheduled',
  'closed',
  'reopened',
  'defect_raised',
  'defect_cured',
  'copy_applied',
  'copy_ready',
  'copy_collected',
] as const;
export type ObligationEventKind = (typeof OBLIGATION_EVENT_KINDS)[number];

export const obligationEvent = tenantTable(
  'obligation_event',
  {
    id: id(),
    obligationId: uuid('obligation_id').notNull(),
    kind: text('kind').$type<ObligationEventKind>().notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    reason: text('reason'),
    actorMemberId: uuid('actor_member_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'obligation_event_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'obligation_event_obligation_fk',
      columns: [t.workspaceId, t.obligationId],
      foreignColumns: [obligation.workspaceId, obligation.id],
    }).onDelete('cascade'),
    check('obligation_event_kind_chk', sql`kind in ${inList(OBLIGATION_EVENT_KINDS)}`),
    // A reschedule is deliberate: it carries its reason.
    check(
      'obligation_event_reschedule_reason_chk',
      sql`kind <> 'rescheduled' or (reason is not null and btrim(reason) <> '')`,
    ),
  ],
);

export const defect = tenantTable(
  'defect',
  {
    id: id(),
    obligationId: uuid('obligation_id').notNull(),
    proceedingId: uuid('proceeding_id').notNull(),
    raisedOn: date('raised_on').notNull(),
    cureBy: date('cure_by').notNull(),
    curedOn: date('cured_on'),
    description: text('description').notNull(),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('defect_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('defect_workspace_obligation_uq').on(t.workspaceId, t.obligationId),
    foreignKey({
      name: 'defect_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'defect_obligation_fk',
      columns: [t.workspaceId, t.obligationId],
      foreignColumns: [obligation.workspaceId, obligation.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'defect_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }),
    foreignKey({
      name: 'defect_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('defect'),
    check('defect_description_chk', sql`btrim(description) <> ''`),
    check('defect_cure_by_chk', sql`cure_by >= raised_on`),
  ],
);

export const CERTIFIED_COPY_STATUSES = ['applied', 'ready', 'collected'] as const;
export type CertifiedCopyStatus = (typeof CERTIFIED_COPY_STATUSES)[number];

export const certifiedCopy = tenantTable(
  'certified_copy',
  {
    id: id(),
    obligationId: uuid('obligation_id').notNull(),
    proceedingId: uuid('proceeding_id').notNull(),
    appliedOn: date('applied_on').notNull(),
    readyOn: date('ready_on'),
    collectedOn: date('collected_on'),
    status: text('status').$type<CertifiedCopyStatus>().notNull().default('applied'),
    /** Where each step was learned (a registry note, a receipt); `source_ref` is the application's. */
    readySourceRef: text('ready_source_ref'),
    collectedSourceRef: text('collected_source_ref'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('certified_copy_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('certified_copy_workspace_obligation_uq').on(t.workspaceId, t.obligationId),
    foreignKey({
      name: 'certified_copy_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'certified_copy_obligation_fk',
      columns: [t.workspaceId, t.obligationId],
      foreignColumns: [obligation.workspaceId, obligation.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'certified_copy_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }),
    foreignKey({
      name: 'certified_copy_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('certified_copy'),
    check('certified_copy_status_chk', sql`status in ${inList(CERTIFIED_COPY_STATUSES)}`),
    // Each step carries its date: ready needs ready_on, collected needs both, and dates only go forward.
    check(
      'certified_copy_steps_chk',
      sql`(status = 'applied' and ready_on is null and collected_on is null) or (status = 'ready' and ready_on is not null and ready_on >= applied_on and collected_on is null) or (status = 'collected' and ready_on is not null and ready_on >= applied_on and collected_on is not null and collected_on >= ready_on)`,
    ),
  ],
);
