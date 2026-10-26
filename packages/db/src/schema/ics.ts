// Calendar interoperability (#53; PRD CA-5; docs/product/09 §3, §8): the private ICS feed and the
// ICS import ledger. Tenant tables under FORCE RLS via `tenantTable()`, composite
// `(workspace_id, *_id)` FKs.
//
// `ics_feed` is one feed per (workspace, user) at a time: only the sha256 hex of the 32-byte token
// is stored (`token_hash`, unique across workspaces so `app_ics_feed_resolve()` can find a feed
// before the workspace is known); rotating replaces the hash and revoking sets `revoked_at`, both
// effective at once. `ics_feed_event` remembers each UID's SEQUENCE and content hash per feed, and
// a snapshot so a removed date can stay in the feed as CANCELLED for 30 days.
// `ics_import_event` is the import ledger: one row per calendar event (UID, or UID#day for an RRULE
// instance) that looked like a hearing, with the highest SEQUENCE seen, so a re-import is
// idempotent. Events that are not hearing-like are never stored.
//
// Nullable composite FKs whose parent can go away are `ON DELETE SET NULL (<column>)` in migration
// 0056 (a plain composite SET NULL would also null `workspace_id`); Drizzle records `set null`.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { proposal } from './automation.ts';
import { capture } from './capture.ts';
import { anchor } from './documents.ts';
import { matter } from './matter-graph.ts';
import { proceeding } from './proceedings.ts';

export const ICS_FEED_SCOPES = ['mine', 'workspace'] as const;
export type IcsFeedScope = (typeof ICS_FEED_SCOPES)[number];

/** Where an imported event stands: the review screen reads this. */
export const ICS_IMPORT_STATUSES = [
  'proposed',
  'unmatched',
  'unchanged',
  'skipped',
  'noted',
  'applied',
] as const;
export type IcsImportStatus = (typeof ICS_IMPORT_STATUSES)[number];

export const icsFeed = tenantTable(
  'ics_feed',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** sha256 hex of the token; the token is never stored. */
    tokenHash: text('token_hash').notNull(),
    scope: text('scope').$type<IcsFeedScope>().notNull().default('mine'),
    includeParties: boolean('include_parties').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** The version of the "outside India" note the user acknowledged. */
    disclosureVersion: text('disclosure_version').notNull(),
  },
  (t) => [
    unique('ics_feed_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('ics_feed_token_hash_uq').on(t.tokenHash),
    uniqueIndex('ics_feed_one_active_uq')
      .on(t.workspaceId, t.userId)
      .where(sql`revoked_at is null`),
    foreignKey({
      name: 'ics_feed_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('ics_feed_scope_chk', sql`scope in ${inList(ICS_FEED_SCOPES)}`),
    check('ics_feed_token_hash_chk', sql`token_hash ~ '^[0-9a-f]{64}$'`),
  ],
);

export interface IcsFeedSnapshot {
  date: string;
  summary: string;
  location: string | null;
  description: string | null;
}

export const icsFeedEvent = tenantTable(
  'ics_feed_event',
  {
    feedId: uuid('feed_id').notNull(),
    uid: text('uid').notNull(),
    sequence: integer('sequence').notNull().default(0),
    contentHash: text('content_hash').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    snapshot: jsonb('snapshot').$type<IcsFeedSnapshot>().notNull(),
  },
  (t) => [
    primaryKey({ name: 'ics_feed_event_pkey', columns: [t.workspaceId, t.feedId, t.uid] }),
    foreignKey({
      name: 'ics_feed_event_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ics_feed_event_feed_fk',
      columns: [t.workspaceId, t.feedId],
      foreignColumns: [icsFeed.workspaceId, icsFeed.id],
    }).onDelete('cascade'),
    check('ics_feed_event_sequence_chk', sql`sequence >= 0`),
  ],
);

export const icsImportEvent = tenantTable(
  'ics_import_event',
  {
    id: id(),
    /** The calendar `UID`, or `UID#YYYY-MM-DD` for an RRULE instance. */
    uid: text('uid').notNull(),
    /** The highest `SEQUENCE` processed for this UID. */
    sequence: integer('sequence').notNull().default(0),
    captureId: uuid('capture_id').notNull(),
    proposalId: uuid('proposal_id'),
    anchorId: uuid('anchor_id'),
    matterId: uuid('matter_id'),
    proceedingId: uuid('proceeding_id'),
    status: text('status').$type<IcsImportStatus>().notNull(),
    /** What the review screen shows: the hearing-like event's own text, nothing else is kept. */
    summary: text('summary').notNull(),
    location: text('location'),
    eventDate: date('event_date').notNull(),
    eventTime: text('event_time'),
    score: numeric('score', { precision: 4, scale: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ics_import_event_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('ics_import_event_workspace_uid_uq').on(t.workspaceId, t.uid),
    index('ics_import_event_workspace_capture_idx').on(t.workspaceId, t.captureId),
    foreignKey({
      name: 'ics_import_event_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ics_import_event_capture_fk',
      columns: [t.workspaceId, t.captureId],
      foreignColumns: [capture.workspaceId, capture.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ics_import_event_proposal_fk',
      columns: [t.workspaceId, t.proposalId],
      foreignColumns: [proposal.workspaceId, proposal.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'ics_import_event_anchor_fk',
      columns: [t.workspaceId, t.anchorId],
      foreignColumns: [anchor.workspaceId, anchor.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'ics_import_event_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'ics_import_event_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }).onDelete('set null'),
    check('ics_import_event_status_chk', sql`status in ${inList(ICS_IMPORT_STATUSES)}`),
    check('ics_import_event_sequence_chk', sql`sequence >= 0`),
  ],
);
