// Court-layer reference tables (#344, part 1 of #32; #32 data contract, ADR 0013): `forum`,
// `court_hall` and `bench`. They are global-or-workspace tables (`globalOrWorkspaceTable()`): a null
// `workspace_id` is the system catalogue (seeded by #34, written only by the owner role, readable by
// every workspace); a workspace id is a custom (A0) forum and its halls and benches, visible and
// writable only inside that workspace. A hall or bench always has its forum's scope: the
// `app_reference_scope_guard` trigger (mode `same`, migration 0037) rejects any other forum, so
// workspaces cannot reference or probe each other's forums. `bench.judges` records the
// court-published composition only; nothing may aggregate by judge across matters or workspaces
// (PX-9, ME-6). Effective-dated rosters are #39.
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, text, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { globalOrWorkspaceTable } from '../schema-helpers/global-or-workspace-table.ts';

import { adapterLevel, benchKind, forumSide, jurisdictionKind } from './enums.ts';

/** Languages a forum publishes and hears in (ISO 639-1 codes). */
export interface ForumLanguageProfile {
  primary?: string;
  secondary?: string[];
  ocr?: string[];
  stt?: string[];
}

export const forum = globalOrWorkspaceTable(
  'forum',
  {
    id: id(),
    /** Stable slug, unique per scope, e.g. `in.tn.madras-hc.principal.appellate`. */
    code: text('code').notNull(),
    court: text('court').notNull(),
    establishment: text('establishment'),
    seat: text('seat'),
    side: forumSide('side').notNull().default('not_applicable'),
    jurisdictionKind: jurisdictionKind('jurisdiction_kind').notNull(),
    languageProfile: jsonb('language_profile')
      .$type<ForumLanguageProfile>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    adapterId: text('adapter_id'),
    adapterLevel: adapterLevel('adapter_level').notNull().default('A0'),
    /** Hosts and deep-link templates (#34). */
    config: jsonb('config')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps(),
  },
  (t) => [unique('forum_scope_code_uq').on(t.workspaceId, t.code).nullsNotDistinct()],
);

export const courtHall = globalOrWorkspaceTable(
  'court_hall',
  {
    id: id(),
    forumId: uuid('forum_id')
      .notNull()
      .references(() => forum.id, { onDelete: 'restrict' }),
    /** Text, not int: halls such as "12A" exist. */
    hallNo: text('hall_no').notNull(),
    label: text('label'),
    ...timestamps(),
  },
  (t) => [
    unique('court_hall_forum_hall_uq').on(t.forumId, t.hallNo),
    index('court_hall_forum_id_idx').on(t.forumId),
  ],
);

export const bench = globalOrWorkspaceTable(
  'bench',
  {
    id: id(),
    forumId: uuid('forum_id')
      .notNull()
      .references(() => forum.id, { onDelete: 'restrict' }),
    /** Normalised display names as the court publishes them. */
    judges: text('judges')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    benchKind: benchKind('bench_kind').notNull(),
    ...timestamps(),
  },
  (t) => [index('bench_forum_id_idx').on(t.forumId)],
);
