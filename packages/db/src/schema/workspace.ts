// Workspace-only tables (#177, spike §4.2). The workspace itself, its members and invitations are
// Better Auth's `organization`, `member` and `invitation` tables, extended in place in `auth.ts`
// (one source of truth, no duplicate tables or views). This file holds what Better Auth has no
// table for: per-workspace settings and the slug redirect history.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, id, timestamps, workspaceIndex } from '../columns.ts';

import { inList, LOCALES, organization } from './auth.ts';

export const workspaceSettings = pgTable(
  'workspace_settings',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    indiaOnlyAi: boolean('india_only_ai').notNull().default(true),
    retention: jsonb('retention').$type<Record<string, unknown>>().notNull().default({}),
    locale: text('locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    // Advocates may read and export the audit log unless an owner turns this off (#229).
    advocatesCanReadAudit: boolean('advocates_can_read_audit').notNull().default(true),
    /** The city the practice is based in, shown on the workspace profile (#284). */
    practiceCity: text('practice_city'),
    // Role settings on the settings roles page (#285); both default on, so `can()` behaves as before.
    /** Advocates may invite members (`member.invite`) unless an owner turns this off. */
    advocatesCanInvite: boolean('advocates_can_invite').notNull().default(true),
    /** Owners see restricted matters they are not listed on unless an owner turns this off. */
    ownersSeeRestricted: boolean('owners_see_restricted').notNull().default(true),
    // Privacy settings on the settings privacy page (#286). `india_only_ai` above has no write path.
    /** New sensitive matters start restricted unless a member with `workspace.manage` turns this off. */
    sensitiveDefaultRestricted: boolean('sensitive_default_restricted').notNull().default(true),
    /** Share public court documents (cause lists, published orders) with every workspace (#485); off by default. */
    contributePublicCourtDocuments: boolean('contribute_public_court_documents')
      .notNull()
      .default(false),
    /** Days raw audio is kept before deletion: 7, 14 or 30 (the PRD maximum, and the default). */
    retentionAudioDays: integer('retention_audio_days').notNull().default(30),
    /** Months a closed enquiry is kept before the retention job deletes it (#87): 1 to 120, default 12. */
    enquiryRetentionMonths: integer('enquiry_retention_months').notNull().default(12),
    /** Corrections may enter eval sets, with per-item consent (#558). Opt-in; only an owner sets it. */
    allowEvalReuse: boolean('allow_eval_reuse').notNull().default(false),
    /** Days without an event before a matter is flagged as stale (#70, `attention.stale_days`): 7 to 180. */
    attentionStaleDays: integer('attention_stale_days').notNull().default(30),
    /** The GST state code (two digits) the invoice editor starts from, so it stops asking (#963). */
    feeSupplierStateCode: text('fee_supplier_state_code'),
    /** Chamber onboarding (#92): how new appearances are delegated by default (validated in core). */
    delegationDefaults: jsonb('delegation_defaults')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Chamber onboarding (#92): the chamber's default brief layout, `short` or `full`. */
    briefFormat: text('brief_format').notNull().default('full'),
    /** The seed version (`DEMO_VERSION`) a demo workspace was last restored to (#93); null elsewhere. */
    demoVersion: text('demo_version'),
    ...timestamps(),
  },
  (t) => [
    // Table-level so the convention checker sees `workspace_id` leading the primary key.
    primaryKey({ name: 'workspace_settings_pkey', columns: [t.workspaceId] }),
    check('workspace_settings_locale_chk', sql`locale in ${inList(LOCALES)}`),
    check('workspace_settings_practice_city_chk', sql`char_length(practice_city) <= 80`),
    check('workspace_settings_retention_audio_days_chk', sql`retention_audio_days in (7, 14, 30)`),
    check(
      'workspace_settings_enquiry_retention_months_chk',
      sql`enquiry_retention_months between 1 and 120`,
    ),
    check(
      'workspace_settings_fee_supplier_state_code_chk',
      sql`fee_supplier_state_code ~ '^[0-9]{2}$'`,
    ),
    check(
      'workspace_settings_attention_stale_days_chk',
      sql`attention_stale_days between 7 and 180`,
    ),
    check('workspace_settings_brief_format_chk', sql`brief_format in ('short', 'full')`),
  ],
);

export const workspaceSlugHistory = pgTable(
  'workspace_slug_history',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** A previous slug; unique so it redirects to exactly one workspace and cannot be reused. */
    slug: citext('slug').notNull().unique('workspace_slug_history_slug_uq'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [workspaceIndex('workspace_slug_history', t.workspaceId)],
);
