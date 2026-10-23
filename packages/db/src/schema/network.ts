// The court document network (#485, D-048 tier 3): public court documents (cause lists, published
// orders) that a workspace opted in to share, stored once globally and reused by every workspace.
// `contributed_document` is a global table (GLOBAL_TABLES): no `workspace_id`, so nothing in it can
// identify the contributor, and no RLS. `contribution_ledger` is the tenant-side link (which
// workspace stood behind which copy): it is what withdrawal and workspace erasure use, and it is
// purged with the workspace. A copy is blanked (`withdrawn_at`, no content), never deleted, once no
// ledger row stands behind it.
import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { source } from './source-registry.ts';

/** The only document kinds that can be contributed. */
export const CONTRIBUTABLE_KINDS = ['cause_list', 'order'] as const;
export type ContributableKind = (typeof CONTRIBUTABLE_KINDS)[number];

export const contributedDocument = pgTable(
  'contributed_document',
  {
    id: id(),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id),
    kind: text('kind').$type<ContributableKind>().notNull(),
    /** The court or forum named on the public document; never a workspace or matter label. */
    forumLabel: text('forum_label'),
    listingDate: date('listing_date'),
    /** The public text, stripped of workspace metadata; null once withdrawn. */
    content: text('content'),
    /** SHA-256 of `content`: a document is stored once. */
    sha256: text('sha256').notNull().unique('contributed_document_sha256_uq'),
    provenance: text('provenance').notNull().default('contributed'),
    contributedAt: timestamp('contributed_at', { withTimezone: true }).notNull().defaultNow(),
    /** `contributed_at` plus the source's `retention_days`. */
    retentionUntil: timestamp('retention_until', { withTimezone: true }).notNull(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [
    check('contributed_document_kind_chk', sql`${t.kind} in ('cause_list', 'order')`),
    check('contributed_document_provenance_chk', sql`${t.provenance} = 'contributed'`),
    check('contributed_document_sha256_chk', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'contributed_document_withdrawn_chk',
      sql`(${t.withdrawnAt} is null) = (${t.content} is not null)`,
    ),
    index('contributed_document_lookup_idx').on(t.sourceId, t.kind, t.listingDate),
  ],
);

export const contributionLedger = tenantTable(
  'contribution_ledger',
  {
    id: id(),
    contributedDocumentId: uuid('contributed_document_id')
      .notNull()
      .references(() => contributedDocument.id),
    /** The workspace's own document that was contributed (not a foreign key: the document may go). */
    documentId: uuid('document_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('contribution_ledger_workspace_doc_uq').on(t.workspaceId, t.contributedDocumentId),
  ],
);
