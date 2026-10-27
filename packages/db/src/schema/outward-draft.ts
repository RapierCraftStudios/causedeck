// Outward update drafts (#69, #735; ADR 0045): `outward_draft` (what is prepared for whom, in which
// language), `outward_draft_version` (the system draft and each lawyer edit, with the facts used)
// and `outward_share_log` (the lawyer's explicit shares). There is no send path: nothing here
// records a transmission by the system. Tenant tables under FORCE RLS via `tenantTable()`. Members
// are bare ids because the log outlives the member (no FK to clear on account deletion).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';
import { hearing, order } from './docket.ts';
import { matter } from './matter-graph.ts';
import { person } from './people.ts';

export const OUTWARD_AUDIENCES = ['client', 'senior_counsel', 'briefing_counsel'] as const;
export type OutwardAudience = (typeof OUTWARD_AUDIENCES)[number];
export const OUTWARD_LANGUAGES = ['en', 'ta', 'kn'] as const;
export type OutwardLanguage = (typeof OUTWARD_LANGUAGES)[number];
export const OUTWARD_TONES = ['formal', 'brief', 'warm'] as const;
export type OutwardTone = (typeof OUTWARD_TONES)[number];
export const OUTWARD_DRAFT_STATUSES = ['drafted', 'edited', 'shared'] as const;
export type OutwardDraftStatus = (typeof OUTWARD_DRAFT_STATUSES)[number];
export const OUTWARD_SHARE_CHANNELS = ['clipboard', 'whatsapp_link', 'mailto', 'download'] as const;
export type OutwardShareChannel = (typeof OUTWARD_SHARE_CHANNELS)[number];

/** One line of a draft's facts: where it came from and whether it was confirmed. */
export interface OutwardFact {
  kind: 'next_date' | 'outcome' | 'obligation';
  /** The line as inserted in the draft body. */
  text: string;
  /** False: the line says "to be confirmed" and the editor flags it. */
  confirmed: boolean;
  provenance: {
    table: 'hearing' | 'order' | 'obligation';
    recordId: string;
    sourceType: string;
    sourceRef: string | null;
    anchorId: string | null;
    confirmationState: string;
  };
}

export const outwardDraft = tenantTable(
  'outward_draft',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    hearingId: uuid('hearing_id'),
    orderId: uuid('order_id'),
    audience: text('audience').$type<OutwardAudience>().notNull(),
    language: text('language').$type<OutwardLanguage>().notNull(),
    tone: text('tone').$type<OutwardTone>().notNull(),
    status: text('status').$type<OutwardDraftStatus>().notNull().default('drafted'),
    /** The existing client the draft is for (client audience only). */
    clientPersonId: uuid('client_person_id'),
    /** True when no model call was made (sensitive matter or AI unavailable). */
    templateOnly: boolean('template_only').notNull().default(false),
    createdBy: uuid('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('outward_draft_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'outward_draft_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'outward_draft_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }),
    foreignKey({
      name: 'outward_draft_hearing_fk',
      columns: [t.workspaceId, t.hearingId],
      foreignColumns: [hearing.workspaceId, hearing.id],
    }),
    foreignKey({
      name: 'outward_draft_order_fk',
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [order.workspaceId, order.id],
    }),
    foreignKey({
      name: 'outward_draft_client_fk',
      columns: [t.workspaceId, t.clientPersonId],
      foreignColumns: [person.workspaceId, person.id],
    }),
    check('outward_draft_audience_chk', sql`audience in ${inList(OUTWARD_AUDIENCES)}`),
    check('outward_draft_language_chk', sql`language in ${inList(OUTWARD_LANGUAGES)}`),
    check('outward_draft_tone_chk', sql`tone in ${inList(OUTWARD_TONES)}`),
    check('outward_draft_status_chk', sql`status in ${inList(OUTWARD_DRAFT_STATUSES)}`),
    // A client draft names its client; no other audience does.
    check('outward_draft_client_chk', sql`(audience = 'client') = (client_person_id is not null)`),
    check('outward_draft_source_chk', sql`hearing_id is not null or order_id is not null`),
  ],
);

export const outwardDraftVersion = tenantTable(
  'outward_draft_version',
  {
    id: id(),
    draftId: uuid('draft_id').notNull(),
    /** `system` for the prepared text, otherwise the editing member's id. */
    author: text('author').notNull(),
    body: text('body').notNull(),
    facts: jsonb('facts')
      .$type<OutwardFact[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('outward_draft_version_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'outward_draft_version_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'outward_draft_version_draft_fk',
      columns: [t.workspaceId, t.draftId],
      foreignColumns: [outwardDraft.workspaceId, outwardDraft.id],
    }).onDelete('cascade'),
    check('outward_draft_version_body_chk', sql`btrim(body) <> ''`),
    check(
      'outward_draft_version_author_chk',
      sql`author = 'system' or author ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
  ],
);

export const outwardShareLog = tenantTable(
  'outward_share_log',
  {
    id: id(),
    draftId: uuid('draft_id').notNull(),
    memberId: uuid('member_id').notNull(),
    channel: text('channel').$type<OutwardShareChannel>().notNull(),
    sharedAt: timestamp('shared_at', { withTimezone: true }).notNull().defaultNow(),
    finalVersionId: uuid('final_version_id').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'outward_share_log_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'outward_share_log_draft_fk',
      columns: [t.workspaceId, t.draftId],
      foreignColumns: [outwardDraft.workspaceId, outwardDraft.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'outward_share_log_version_fk',
      columns: [t.workspaceId, t.finalVersionId],
      foreignColumns: [outwardDraftVersion.workspaceId, outwardDraftVersion.id],
    }).onDelete('cascade'),
    check('outward_share_log_channel_chk', sql`channel in ${inList(OUTWARD_SHARE_CHANNELS)}`),
  ],
);
