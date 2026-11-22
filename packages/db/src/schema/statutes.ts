// The statute and section layer (#1123, part 1 of #1116; D-053, D-001 amended / ADR 0051): global
// tables, no `workspace_id`, no RLS. The app role may only SELECT them; the rows are written by the
// owner role (the demo seed, later an owner-run import). Only bare-act text (public domain) or a
// synthetic paraphrase is stored, never editorial content (SCC headnotes, annotations, commentary),
// and every act and version carries a `source_note` and a `synthetic` mark.
//
// - Keys are stored as `normaliseStatute` and `normaliseSection` of `@causedeck/intelligence` write
//   them (`indian penal code`, `304a`), the same keys as `judgment_statute_ref`, so a section joins the
//   corpus facets directly.
// - The IPC/BNS, CrPC/BNSS and IEA/BSA correspondence is not stored here: `CODE_MAP`
//   (packages/intelligence/src/corpus/enrich/code-map.ts) is the only correspondence table.
// - History: a section's text is a series of versions over half-open `[valid_from, valid_to)` day
//   ranges (a null `valid_to` is open-ended). `statute_section_version_period_excl` is a btree_gist
//   exclusion constraint rejecting overlapping versions of one section, hand-written in the
//   migration because Drizzle cannot declare EXCLUDE (as `bench_roster_active_period_excl`).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Postgres `tsvector`; only ever a generated column, so it is read, never written. */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** An enactment: the IPC, the BNS, the CrPC, the BNSS and so on. */
export const statuteAct = pgTable('statute_act', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** `normaliseStatute` of the title (`indian penal code`). */
  key: text('key').notNull().unique('statute_act_key_uq'),
  title: text('title').notNull(),
  /** The short form lawyers write (`IPC`, `BNSS`). */
  shortName: text('short_name'),
  year: integer('year'),
  /** The day the act came into force. */
  inForceFrom: date('in_force_from').notNull(),
  /** Where the text comes from (bare act, gazette) or that it is a synthetic paraphrase. */
  sourceNote: text('source_note').notNull(),
  synthetic: boolean('synthetic').notNull(),
});

/** A section of an act; its text lives in `statute_section_version`. */
export const statuteSection = pgTable(
  'statute_section',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actId: uuid('act_id')
      .notNull()
      .references(() => statuteAct.id, { onDelete: 'cascade' }),
    /** `normaliseSection` of the section number (`304a`, `11(6)`). */
    section: text('section').notNull(),
    heading: text('heading').notNull(),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', "section" || ' ' || "heading")`,
    ),
  },
  (t) => [
    uniqueIndex('statute_section_act_section_uq').on(t.actId, t.section),
    index('statute_section_search_tsv_idx').using('gin', t.searchTsv),
  ],
);

/** The text of a section over `[valid_from, valid_to)`; versions of one section never overlap. */
export const statuteSectionVersion = pgTable(
  'statute_section_version',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => statuteSection.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    validFrom: date('valid_from').notNull(),
    /** Exclusive; null while the version is in force. */
    validTo: date('valid_to'),
    /** The amending act or notification, when the version came from an amendment. */
    amendedBy: text('amended_by'),
    sourceNote: text('source_note').notNull(),
    /** True when `text` is a synthetic paraphrase rather than the bare-act wording. */
    synthetic: boolean('synthetic').notNull(),
  },
  (t) => [
    index('statute_section_version_section_idx').on(t.sectionId),
    check(
      'statute_section_version_period_check',
      sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`,
    ),
  ],
);
