import { getTableColumns, sql } from 'drizzle-orm';
import { getTableConfig, pgTable, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONFIRMATION_STATES,
  id,
  provenance,
  provenanceCheck,
  SOURCE_TYPES,
  timestamps,
  workspaceId,
  workspaceIndex,
} from '../columns.ts';
import { EMBEDDING_DIMENSIONS, embedding } from '../vector.ts';
import { pgCode, rejection, scratchWithTables, type ScratchDb } from './fixtures/index.ts';

/** A tenant table that stores a fact: the shape every later domain table follows. */
const fact = pgTable(
  'fixture_fact',
  {
    id: id(),
    workspaceId: workspaceId(),
    body: text('body').notNull(),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [workspaceIndex('fixture_fact', t.workspaceId), provenanceCheck('fixture_fact')],
);

const WS = '01890a5d-ac96-774b-bcce-b302099a8057';
const ANCHOR = '01890a5d-ac96-774b-bcce-b302099a8058';

describe('column helpers (static shape)', () => {
  it('provenance() yields exactly the five provenance columns', () => {
    const cols = getTableColumns(fact);
    const columns = Object.keys(provenance()).map((key) => cols[key as keyof typeof cols].name);
    expect(columns).toEqual([
      'source_type',
      'source_ref',
      'anchor_id',
      'confidence',
      'confirmation_state',
    ]);
  });

  it('types the columns as the spike specifies', () => {
    const cols = getTableColumns(fact);
    expect(cols.sourceType.notNull).toBe(true);
    expect(cols.sourceType.enumValues).toEqual([...SOURCE_TYPES]);
    expect(cols.confirmationState.enumValues).toEqual([...CONFIRMATION_STATES]);
    expect(cols.confirmationState.default).toBe('proposed');
    expect(cols.confidence.getSQLType()).toBe('numeric(4, 3)');
    expect(cols.anchorId.getSQLType()).toBe('uuid');
    expect(cols.anchorId.notNull).toBe(false);
    expect(cols.sourceRef.getSQLType()).toBe('text');
    expect(cols.workspaceId.notNull).toBe(true);
    expect(cols.id.primary).toBe(true);
    expect(cols.createdAt.getSQLType()).toBe('timestamp with time zone');
  });

  it('workspaceIndex() leads with workspace_id and provenanceCheck() names its constraint', () => {
    const config = getTableConfig(fact);
    expect(config.indexes[0]?.config.name).toBe('fixture_fact_workspace_id_idx');
    expect(config.checks.map((c) => c.name)).toEqual(['fixture_fact_provenance_chk']);
  });

  it('sizes embeddings from the EMBEDDING_DIMENSIONS constant', () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
    const t = pgTable('fixture_vec', { e: embedding() });
    expect(getTableColumns(t).e.getSQLType()).toBe('vector(1024)');
  });
});

describe('provenance CHECK (real Postgres)', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await scratchWithTables('columns_test', { fact });
  });
  afterAll(async () => {
    await scratch.close();
  });

  it('rejects an AI-sourced row with neither anchor_id nor source_ref', async () => {
    const error = await rejection(
      scratch.appDb.insert(fact).values({ workspaceId: WS, body: 'x', sourceType: 'ai' }),
    );
    expect(pgCode(error)).toBe('23514'); // check_violation
  });

  it('accepts manual rows, anchored rows and rows with a source_ref', async () => {
    const rows = await scratch.appDb
      .insert(fact)
      .values([
        { workspaceId: WS, body: 'typed by hand', sourceType: 'manual' },
        {
          workspaceId: WS,
          body: 'from a page',
          sourceType: 'ai',
          anchorId: ANCHOR,
          confidence: '0.875',
        },
        { workspaceId: WS, body: 'from a list', sourceType: 'adapter', sourceRef: 'cause-list:42' },
      ])
      .returning();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.confirmationState === 'proposed')).toBe(true);
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a missing workspace_id and confidence outside numeric(4,3)', async () => {
    const missing = await rejection(
      scratch.appDb.execute(
        sql`insert into fixture_fact (body, source_type) values ('x', 'manual')`,
      ),
    );
    expect(pgCode(missing)).toBe('23502'); // not_null_violation
    const tooBig = await rejection(
      scratch.appDb
        .insert(fact)
        .values({ workspaceId: WS, body: 'x', sourceType: 'manual', confidence: '12.5' }),
    );
    expect(pgCode(tooBig)).toBe('22003'); // numeric_value_out_of_range
  });

  it('creates the workspace index in the database', async () => {
    const rows = await scratch.appDb.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = 'fixture_fact' and indexname = 'fixture_fact_workspace_id_idx'`,
    );
    expect(rows[0]?.indexdef).toMatch(/\(workspace_id\)/);
  });
});
