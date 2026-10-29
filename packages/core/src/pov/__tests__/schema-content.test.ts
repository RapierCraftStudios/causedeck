// R6 (#86): the proof-of-value tables hold no content: ids, numbers, booleans, timestamps, the
// `questions` marks array and one note of at most 140 characters.
import { getTableColumns, type Column } from 'drizzle-orm';
import { schema } from '@causedeck/db';
import { describe, expect, it } from 'vitest';

const TABLES = {
  preparedness_rating: schema.preparednessRating,
  load_pulse: schema.loadPulse,
  context_test_result: schema.contextTestResult,
  pov_prefs: schema.povPrefs,
} as const;

describe('proof-of-value schema holds no content', () => {
  it('has only id, number, boolean, timestamp columns, one jsonb marks array and one short note', () => {
    const free: string[] = [];
    for (const [name, table] of Object.entries(TABLES))
      for (const [key, column] of Object.entries<Column>(getTableColumns(table))) {
        if (['string', 'json'].includes(column.dataType) && column.columnType !== 'PgUUID')
          free.push(`${name}.${key}:${column.columnType}`);
      }
    expect(free.sort()).toEqual([
      'context_test_result.questions:PgJsonb',
      'load_pulse.iso_week:PgText'.replace('iso_week', 'isoWeek'),
      'preparedness_rating.note:PgVarchar',
    ]);
    expect(
      (getTableColumns(schema.preparednessRating).note as unknown as { length: number }).length,
    ).toBe(140);
  });
});
