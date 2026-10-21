// The docket of the matter graph (#347, part 4 of #32; #32 data contract, ADR 0013): `listing`,
// `hearing`, `appearance`, `order`, `obligation` and `task`, tenant tables under FORCE RLS via
// `tenantTable()`. All but `appearance` carry provenance. A proceeding has at most one canonical
// listing (the next date): `listing_one_canonical_uq` is a partial unique index. Hall and bench
// references are single-column FKs into the global-or-workspace court tables, guarded by
// `<table>_<column>_scope_guard` triggers (mode `same_or_global`, migration 0040).
//
// Delete actions: the facts keep the proceeding, matter, document and anchor they cite until they
// go themselves (NO ACTION; the erase purges them first). Appearances cascade with their hearing.
// Member references and optional fact links are `ON DELETE SET NULL (<column>)` in migration 0040
// (a plain composite SET NULL would also null `workspace_id`); Drizzle records them as `set null`.
//
// A closed obligation needs a reason type and `closed_at` (and a note for `not_applicable`):
// `obligation_closure_chk`. It also needs `closed_by`, but that member reference is cleared when the
// closer's account is deleted (member rows cascade with the user), so the `obligation_closed_by_guard`
// trigger enforces it instead, letting only that FK action through. `appearing_for_person_id` has no
// FK until `person` exists (#348).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, provenance, provenanceCheck, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, member, organization } from './auth.ts';
import { bench, courtHall } from './court.ts';
import { anchor, document } from './documents.ts';
import {
  appearanceCapacity,
  listType,
  obligationSource,
  obligationStatus,
  orderType,
} from './enums.ts';
import { matter } from './matter-graph.ts';
import { proceeding } from './proceedings.ts';

export const listing = tenantTable(
  'listing',
  {
    id: id(),
    proceedingId: uuid('proceeding_id').notNull(),
    listDate: date('list_date').notNull(),
    listType: listType('list_type').notNull(),
    listNo: integer('list_no'),
    itemNo: text('item_no'),
    /** The stage heading as printed (open enum). */
    stageRaw: text('stage_raw').notNull(),
    /** The normalised stage key (open enum). */
    stageNorm: text('stage_norm'),
    /** A catalogue hall or one of the workspace's own (scope-guarded, ADR 0013). */
    hallId: uuid('hall_id').references(() => courtHall.id, { onDelete: 'restrict' }),
    /** A catalogue bench or one of the workspace's own (scope-guarded, ADR 0013). */
    benchId: uuid('bench_id').references(() => bench.id, { onDelete: 'restrict' }),
    /** The proceeding's next date: at most one canonical listing per proceeding. */
    canonical: boolean('canonical').notNull().default(false),
    sourceDocumentId: uuid('source_document_id'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('listing_workspace_id_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('listing_one_canonical_uq')
      .on(t.workspaceId, t.proceedingId)
      .where(sql`canonical`),
    index('listing_workspace_proceeding_date_idx').on(t.workspaceId, t.proceedingId, t.listDate),
    index('listing_workspace_date_hall_idx').on(t.workspaceId, t.listDate, t.hallId),
    foreignKey({
      name: 'listing_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'listing_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }),
    foreignKey({
      name: 'listing_source_document_fk',
      columns: [t.workspaceId, t.sourceDocumentId],
      foreignColumns: [document.workspaceId, document.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'listing_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('listing'),
    check('listing_list_no_chk', sql`list_no is null or list_no > 0`),
  ],
);

export const hearing = tenantTable(
  'hearing',
  {
    id: id(),
    listingId: uuid('listing_id').notNull(),
    heldOn: date('held_on').notNull(),
    outcome: text('outcome'),
    adjournmentReason: text('adjournment_reason'),
    nextDateProposed: date('next_date_proposed'),
    nextDateConfirmed: date('next_date_confirmed'),
    stageAfterRaw: text('stage_after_raw'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('hearing_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('hearing_workspace_listing_idx').on(t.workspaceId, t.listingId),
    foreignKey({
      name: 'hearing_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'hearing_listing_fk',
      columns: [t.workspaceId, t.listingId],
      foreignColumns: [listing.workspaceId, listing.id],
    }),
    foreignKey({
      name: 'hearing_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('hearing'),
  ],
);

export const appearance = tenantTable(
  'appearance',
  {
    id: id(),
    hearingId: uuid('hearing_id').notNull(),
    /** Null for a proxy or senior outside the workspace, or once the membership is gone. */
    memberId: uuid('member_id'),
    capacity: appearanceCapacity('capacity').notNull(),
    /** References `person` once it exists (#348). */
    appearingForPersonId: uuid('appearing_for_person_id'),
    ...timestamps(),
  },
  (t) => [
    unique('appearance_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('appearance_workspace_hearing_idx').on(t.workspaceId, t.hearingId),
    foreignKey({
      name: 'appearance_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'appearance_hearing_fk',
      columns: [t.workspaceId, t.hearingId],
      foreignColumns: [hearing.workspaceId, hearing.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'appearance_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('set null'),
  ],
);

/** One operative direction of an order, anchored to where the order says it. */
export interface OperativeDirection {
  text: string;
  anchorId: string;
}

export const order = tenantTable(
  'order',
  {
    id: id(),
    proceedingId: uuid('proceeding_id').notNull(),
    documentId: uuid('document_id').notNull(),
    orderDate: date('order_date').notNull(),
    /** A catalogue bench or one of the workspace's own (scope-guarded, ADR 0013). */
    benchId: uuid('bench_id').references(() => bench.id, { onDelete: 'restrict' }),
    orderType: orderType('order_type').notNull(),
    neutralCitation: text('neutral_citation'),
    operativeDirections: jsonb('operative_directions')
      .$type<OperativeDirection[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    nextDate: date('next_date'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('order_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('order_workspace_proceeding_date_idx').on(t.workspaceId, t.proceedingId, t.orderDate),
    foreignKey({
      name: 'order_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'order_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }),
    foreignKey({
      name: 'order_document_fk',
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [document.workspaceId, document.id],
    }),
    foreignKey({
      name: 'order_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('order'),
    check('order_operative_directions_chk', sql`jsonb_typeof(operative_directions) = 'array'`),
  ],
);

export const OBLIGATION_CLOSED_REASON_TYPES = [
  'task_completed',
  'lawyer_action',
  'not_applicable',
] as const;
export type ObligationClosedReasonType = (typeof OBLIGATION_CLOSED_REASON_TYPES)[number];

export const obligation = tenantTable(
  'obligation',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    proceedingId: uuid('proceeding_id'),
    source: obligationSource('source').notNull(),
    description: text('description').notNull(),
    dueDate: date('due_date'),
    basis: text('basis'),
    /** Null once the owner's membership is gone (account deletion). */
    ownerMemberId: uuid('owner_member_id'),
    status: obligationStatus('status').notNull().default('open'),
    closedReasonType: text('closed_reason_type').$type<ObligationClosedReasonType>(),
    /** Required on closure (trigger); null only once the closer's membership is gone. */
    closedBy: uuid('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedNote: text('closed_note'),
    sourceOrderId: uuid('source_order_id'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('obligation_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('obligation_workspace_matter_status_idx').on(t.workspaceId, t.matterId, t.status),
    index('obligation_workspace_due_date_idx').on(t.workspaceId, t.dueDate),
    foreignKey({
      name: 'obligation_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'obligation_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }),
    foreignKey({
      name: 'obligation_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }),
    foreignKey({
      name: 'obligation_owner_member_fk',
      columns: [t.workspaceId, t.ownerMemberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'obligation_closed_by_fk',
      columns: [t.workspaceId, t.closedBy],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'obligation_source_order_fk',
      columns: [t.workspaceId, t.sourceOrderId],
      foreignColumns: [order.workspaceId, order.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'obligation_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('obligation'),
    check('obligation_description_chk', sql`btrim(description) <> ''`),
    check(
      'obligation_closed_reason_type_chk',
      sql`closed_reason_type is null or closed_reason_type in ${inList(OBLIGATION_CLOSED_REASON_TYPES)}`,
    ),
    // `is not null` first: `null in (...)` is null, which a CHECK lets through.
    check(
      'obligation_closure_chk',
      sql`status = 'open' or (closed_reason_type is not null and closed_reason_type in ${inList(OBLIGATION_CLOSED_REASON_TYPES)} and closed_at is not null and (status <> 'not_applicable' or (closed_note is not null and btrim(closed_note) <> '')))`,
    ),
  ],
);

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const task = tenantTable(
  'task',
  {
    id: id(),
    matterId: uuid('matter_id'),
    proceedingId: uuid('proceeding_id'),
    title: text('title').notNull(),
    dueDate: date('due_date'),
    /** Null once the owner's membership is gone (account deletion). */
    ownerMemberId: uuid('owner_member_id'),
    status: text('status').$type<TaskStatus>().notNull().default('open'),
    fulfilsObligationId: uuid('fulfils_obligation_id'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('task_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('task_workspace_matter_idx').on(t.workspaceId, t.matterId),
    index('task_workspace_owner_status_idx').on(t.workspaceId, t.ownerMemberId, t.status),
    foreignKey({
      name: 'task_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'task_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }),
    foreignKey({
      name: 'task_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }),
    foreignKey({
      name: 'task_owner_member_fk',
      columns: [t.workspaceId, t.ownerMemberId],
      foreignColumns: [member.organizationId, member.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'task_fulfils_obligation_fk',
      columns: [t.workspaceId, t.fulfilsObligationId],
      foreignColumns: [obligation.workspaceId, obligation.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'task_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }),
    provenanceCheck('task'),
    check('task_title_chk', sql`btrim(title) <> ''`),
    check('task_status_chk', sql`status in ${inList(TASK_STATUSES)}`),
  ],
);
