// The hand-written matter-graph schemas in `@causedeck/validators/matter-graph` (#349) match the
// tables: the same keys, a key optional on insert exactly where the column is nullable or has a
// default, nullable on select exactly where the column is, the same enum values, the same select
// types, and rows the fixtures write parse with the select schemas. `@causedeck/db` depends on the
// validators package, so the schemas cannot be derived from the tables (ADR 0013).
import * as v from '@causedeck/validators/matter-graph';
import * as r from '@causedeck/validators/roster';
import { eq, getTableColumns, is, type InferSelectModel, type Table } from 'drizzle-orm';
import { PgEnumColumn } from 'drizzle-orm/pg-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { CONFIRMATION_STATES, SOURCE_TYPES } from '../columns.ts';
import { bench, courtHall, forum } from '../schema/court.ts';
import {
  appearance,
  hearing,
  listing,
  obligation,
  OBLIGATION_CLOSED_REASON_TYPES,
  order,
  task,
  TASK_STATUSES,
} from '../schema/docket.ts';
import {
  ANCHOR_KINDS,
  ANCHOR_QUOTE_MAX,
  anchor,
  document,
  documentPage,
} from '../schema/documents.ts';
import * as enums from '../schema/enums.ts';
import { matter, MATTER_STATUSES } from '../schema/matter-graph.ts';
import { organisation, person, roleEdge } from '../schema/people.ts';
import {
  CNR_PATTERN,
  proceeding,
  proceedingLink,
  proceedingStateChange,
  PROCEEDING_LINK_KINDS,
} from '../schema/proceedings.ts';
import {
  BENCH_CHANGE_ALERT_STATUSES,
  BENCH_CHANGE_REASONS,
  BENCH_ROSTER_STATUSES,
  benchChangeAlert,
  benchRoster,
  benchRosterEntry,
} from '../schema/roster.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import {
  buildAnchor,
  buildChennaiSoloGraph,
  buildDocument,
  buildHearing,
  buildObligation,
  buildOrder,
  buildTask,
} from '../testing/matter-graph-fixtures.ts';
import { newWorkspace } from './rls/fixtures.ts';

/** The parts of a zod schema this test uses (`@causedeck/db` does not depend on zod). */
interface Parser {
  safeParse(value: unknown): { success: boolean };
}
interface ObjectParser extends Parser {
  shape: Record<string, Parser>;
}

const PAIRS: [string, Table, ObjectParser, ObjectParser][] = [
  ['forum', forum, v.ForumSelectSchema, v.ForumInsertSchema],
  ['court_hall', courtHall, v.CourtHallSelectSchema, v.CourtHallInsertSchema],
  ['bench', bench, v.BenchSelectSchema, v.BenchInsertSchema],
  ['matter', matter, v.MatterSelectSchema, v.MatterInsertSchema],
  ['document', document, v.DocumentSelectSchema, v.DocumentInsertSchema],
  ['document_page', documentPage, v.DocumentPageSelectSchema, v.DocumentPageInsertSchema],
  ['anchor', anchor, v.AnchorSelectSchema, v.AnchorInsertSchema],
  ['proceeding', proceeding, v.ProceedingSelectSchema, v.ProceedingInsertSchema],
  ['proceeding_link', proceedingLink, v.ProceedingLinkSelectSchema, v.ProceedingLinkInsertSchema],
  [
    'proceeding_state_change',
    proceedingStateChange,
    v.ProceedingStateChangeSelectSchema,
    v.ProceedingStateChangeInsertSchema,
  ],
  ['listing', listing, v.ListingSelectSchema, v.ListingInsertSchema],
  ['hearing', hearing, v.HearingSelectSchema, v.HearingInsertSchema],
  ['appearance', appearance, v.AppearanceSelectSchema, v.AppearanceInsertSchema],
  ['order', order, v.OrderSelectSchema, v.OrderInsertSchema],
  ['obligation', obligation, v.ObligationSelectSchema, v.ObligationInsertSchema],
  ['task', task, v.TaskSelectSchema, v.TaskInsertSchema],
  ['person', person, v.PersonSelectSchema, v.PersonInsertSchema],
  ['organisation', organisation, v.OrganisationSelectSchema, v.OrganisationInsertSchema],
  ['role_edge', roleEdge, v.RoleEdgeSelectSchema, v.RoleEdgeInsertSchema],
  // Bench rosters (#384): `@causedeck/validators/roster`.
  ['bench_roster', benchRoster, r.BenchRosterSelectSchema, r.BenchRosterInsertSchema],
  [
    'bench_roster_entry',
    benchRosterEntry,
    r.BenchRosterEntrySelectSchema,
    r.BenchRosterEntryInsertSchema,
  ],
  [
    'bench_change_alert',
    benchChangeAlert,
    r.BenchChangeAlertSelectSchema,
    r.BenchChangeAlertInsertSchema,
  ],
];

describe('@causedeck/validators/matter-graph matches the tables', () => {
  it.each(PAIRS)('%s: same keys, optionality and nullability', (_name, table, select, insert) => {
    const columns = getTableColumns(table);
    const keys = Object.keys(columns).sort();
    expect(Object.keys(select.shape).sort()).toEqual(keys);
    expect(Object.keys(insert.shape).sort()).toEqual(keys);
    for (const [key, column] of Object.entries(columns)) {
      const optional = !column.notNull || column.hasDefault || column.defaultFn !== undefined;
      expect(insert.shape[key]?.safeParse(undefined).success, `${key} optional on insert`).toBe(
        optional,
      );
      expect(select.shape[key]?.safeParse(undefined).success, `${key} present on select`).toBe(
        false,
      );
      expect(select.shape[key]?.safeParse(null).success, `${key} nullable on select`).toBe(
        !column.notNull,
      );
    }
  });

  it.each(PAIRS)('%s: same pg enum values', (_name, table, select) => {
    for (const [key, column] of Object.entries(getTableColumns(table))) {
      if (!is(column, PgEnumColumn)) continue;
      const field = select.shape[key];
      for (const value of column.enumValues) {
        expect(field?.safeParse(value).success, `${key} accepts ${value}`).toBe(true);
      }
      expect(field?.safeParse('not_a_value').success, `${key} rejects others`).toBe(false);
    }
  });

  it('has the same value lists and limits', () => {
    expect(v.SOURCE_TYPES).toEqual(SOURCE_TYPES);
    expect(v.CONFIRMATION_STATES).toEqual(CONFIRMATION_STATES);
    expect(v.FORUM_SIDES).toEqual(enums.FORUM_SIDES);
    expect(v.JURISDICTION_KINDS).toEqual(enums.JURISDICTION_KINDS);
    expect(v.ADAPTER_LEVELS).toEqual(enums.ADAPTER_LEVELS);
    expect(v.BENCH_KINDS).toEqual(enums.BENCH_KINDS);
    expect(v.PROCEEDING_KINDS).toEqual(enums.PROCEEDING_KINDS);
    expect(v.PROCEEDING_STATES).toEqual(enums.PROCEEDING_STATES);
    expect(v.LIST_TYPES).toEqual(enums.LIST_TYPES);
    expect(v.APPEARANCE_CAPACITIES).toEqual(enums.APPEARANCE_CAPACITIES);
    expect(v.ORDER_TYPES).toEqual(enums.ORDER_TYPES);
    expect(v.OBLIGATION_SOURCES).toEqual(enums.OBLIGATION_SOURCES);
    expect(v.OBLIGATION_STATUSES).toEqual(enums.OBLIGATION_STATUSES);
    expect(v.PERSON_KINDS).toEqual(enums.PERSON_KINDS);
    expect(v.ROLE_EDGE_KINDS).toEqual(enums.ROLE_EDGE_KINDS);
    expect(v.DOCUMENT_KINDS).toEqual(enums.DOCUMENT_KINDS);
    expect(v.DOCUMENT_TEXT_STATUSES).toEqual(enums.DOCUMENT_TEXT_STATUSES);
    expect(v.MATTER_STATUSES).toEqual(MATTER_STATUSES);
    expect(v.ANCHOR_KINDS).toEqual(ANCHOR_KINDS);
    expect(v.PROCEEDING_LINK_KINDS).toEqual(PROCEEDING_LINK_KINDS);
    expect(v.OBLIGATION_CLOSED_REASON_TYPES).toEqual(OBLIGATION_CLOSED_REASON_TYPES);
    expect(v.TASK_STATUSES).toEqual(TASK_STATUSES);
    expect(v.ANCHOR_QUOTE_MAX).toBe(ANCHOR_QUOTE_MAX);
    expect(v.CNR_PATTERN.source).toBe(CNR_PATTERN);
    expect(r.BENCH_ROSTER_STATUSES).toEqual(BENCH_ROSTER_STATUSES);
    expect(r.BENCH_CHANGE_REASONS).toEqual(BENCH_CHANGE_REASONS);
    expect(r.BENCH_CHANGE_ALERT_STATUSES).toEqual(BENCH_CHANGE_ALERT_STATUSES);
  });

  it('infers the select types of the tables', () => {
    expectTypeOf<v.Forum>().toEqualTypeOf<InferSelectModel<typeof forum>>();
    expectTypeOf<v.CourtHall>().toEqualTypeOf<InferSelectModel<typeof courtHall>>();
    expectTypeOf<v.Bench>().toEqualTypeOf<InferSelectModel<typeof bench>>();
    expectTypeOf<v.Matter>().toEqualTypeOf<InferSelectModel<typeof matter>>();
    expectTypeOf<v.Document>().toEqualTypeOf<InferSelectModel<typeof document>>();
    expectTypeOf<v.DocumentPage>().toEqualTypeOf<InferSelectModel<typeof documentPage>>();
    expectTypeOf<v.Anchor>().toEqualTypeOf<InferSelectModel<typeof anchor>>();
    expectTypeOf<v.Proceeding>().toEqualTypeOf<InferSelectModel<typeof proceeding>>();
    expectTypeOf<v.ProceedingLink>().toEqualTypeOf<InferSelectModel<typeof proceedingLink>>();
    expectTypeOf<v.ProceedingStateChange>().toEqualTypeOf<
      InferSelectModel<typeof proceedingStateChange>
    >();
    expectTypeOf<v.Listing>().toEqualTypeOf<InferSelectModel<typeof listing>>();
    expectTypeOf<v.Hearing>().toEqualTypeOf<InferSelectModel<typeof hearing>>();
    expectTypeOf<v.Appearance>().toEqualTypeOf<InferSelectModel<typeof appearance>>();
    expectTypeOf<v.Order>().toEqualTypeOf<InferSelectModel<typeof order>>();
    expectTypeOf<v.Obligation>().toEqualTypeOf<InferSelectModel<typeof obligation>>();
    expectTypeOf<v.Task>().toEqualTypeOf<InferSelectModel<typeof task>>();
    expectTypeOf<v.Person>().toEqualTypeOf<InferSelectModel<typeof person>>();
    expectTypeOf<v.Organisation>().toEqualTypeOf<InferSelectModel<typeof organisation>>();
    expectTypeOf<v.RoleEdge>().toEqualTypeOf<InferSelectModel<typeof roleEdge>>();
    expectTypeOf<r.BenchRoster>().toEqualTypeOf<InferSelectModel<typeof benchRoster>>();
    expectTypeOf<r.BenchRosterEntry>().toEqualTypeOf<InferSelectModel<typeof benchRosterEntry>>();
    expectTypeOf<r.BenchChangeAlert>().toEqualTypeOf<InferSelectModel<typeof benchChangeAlert>>();
  });

  it('parses rows the fixtures write with the select schemas', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await inWorkspace(tx, ws.id, async (s) => {
        const graph = await buildChennaiSoloGraph(s, ws.id);
        const doc = await buildDocument(s, ws.id, { matterId: graph.matterId });
        const a = await buildAnchor(s, ws.id, { documentId: doc.id });
        const o = await buildOrder(s, ws.id, {
          proceedingId: graph.writPetitionId,
          documentId: doc.id,
          sourceType: 'document',
          anchorId: a.id,
          confidence: '0.900',
          operativeDirections: [{ text: 'List after two weeks.', anchorId: a.id }],
        });
        await buildHearing(s, ws.id, { listingId: graph.listingId });
        const ob = await buildObligation(s, ws.id, {
          matterId: graph.matterId,
          sourceOrderId: o.id,
        });
        await buildTask(s, ws.id, { matterId: graph.matterId, fulfilsObligationId: ob.id });

        let parsed = 0;
        for (const [name, table, select] of PAIRS) {
          const workspace = getTableColumns(table).workspaceId;
          if (workspace === undefined) throw new Error(`${name} has no workspaceId`);
          const rows = (await s.select().from(table).where(eq(workspace, ws.id))) as unknown[];
          for (const row of rows) {
            const result = select.safeParse(row);
            expect(result.success, `${name} row parses: ${JSON.stringify(result)}`).toBe(true);
            parsed += 1;
          }
        }
        expect(parsed).toBeGreaterThan(20);
      });
    });
  });
});
