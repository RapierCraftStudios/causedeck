// The official notices feed (#584, part 1 of #480; D-048): `notice` is a global table (GLOBAL_TABLES,
// no workspace, no RLS) of court circulars, practice directions, rosters, holiday lists, registry,
// Bar Council and Gazette notices read from a cleared `source`; the app role may SELECT, INSERT and
// UPDATE it, never DELETE. `notice_match` is the tenant table (FORCE RLS via `tenantTable()`) that
// ties a notice to a matter or forum of one workspace. A notice's document is a storage key, hash and
// type rather than a `blob` foreign key: `blob` is a tenant table and a global row cannot reference it.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, provenance, provenanceCheck, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';
import { forum } from './court.ts';
import { matter } from './matter-graph.ts';
import { source } from './source-registry.ts';

export const NOTICE_KINDS = [
  'circular',
  'practice_direction',
  'roster',
  'holiday',
  'registry',
  'bar_council',
  'gazette',
  'other',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const noticeKind = pgEnum('notice_kind', NOTICE_KINDS);

/** Why a notice was matched: it names a forum the workspace uses, or a forum of a matter. */
export const NOTICE_MATCH_REASONS = ['forum', 'matter_forum'] as const;
export type NoticeMatchReason = (typeof NOTICE_MATCH_REASONS)[number];

export const notice = pgTable(
  'notice',
  {
    id: id(),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'restrict' }),
    /** Forum catalogue codes the notice concerns; codes, not foreign keys (matching is #586). */
    forumCodes: text('forum_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    kind: noticeKind('kind').notNull(),
    title: text('title').notNull(),
    issuedOn: date('issued_on').notNull(),
    effectiveOn: date('effective_on'),
    url: text('url').notNull(),
    /** Storage key, hex sha256 and media type of the notice document; all set or all null. */
    documentKey: text('document_key'),
    documentSha256: text('document_sha256'),
    documentMime: text('document_mime'),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    // One row per notice URL of a source: re-polling is idempotent.
    unique('notice_source_url_uq').on(t.sourceId, t.url),
    index('notice_issued_on_idx').on(t.issuedOn),
    index('notice_forum_codes_idx').using('gin', t.forumCodes),
    provenanceCheck('notice'),
    check('notice_title_chk', sql`btrim(title) <> ''`),
    check(
      'notice_document_chk',
      sql`(document_key is null and document_sha256 is null and document_mime is null) or (document_key is not null and document_sha256 ~ '^[0-9a-f]{64}$' and document_mime is not null)`,
    ),
  ],
);

export const noticeMatch = tenantTable(
  'notice_match',
  {
    id: id(),
    noticeId: uuid('notice_id')
      .notNull()
      .references(() => notice.id, { onDelete: 'cascade' }),
    matterId: uuid('matter_id'),
    /** A catalogue forum or one of the workspace's own (scope-guarded, ADR 0013). */
    forumId: uuid('forum_id').references(() => forum.id, { onDelete: 'restrict' }),
    reason: text('reason').$type<NoticeMatchReason>().notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'notice_match_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'notice_match_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    uniqueIndex('notice_match_matter_uq')
      .on(t.workspaceId, t.noticeId, t.matterId)
      .where(sql`matter_id is not null`),
    uniqueIndex('notice_match_forum_uq')
      .on(t.workspaceId, t.noticeId, t.forumId)
      .where(sql`matter_id is null`),
    index('notice_match_workspace_matter_idx').on(t.workspaceId, t.matterId),
    check('notice_match_target_chk', sql`matter_id is not null or forum_id is not null`),
    check('notice_match_reason_chk', sql`reason in ${inList(NOTICE_MATCH_REASONS)}`),
  ],
);
