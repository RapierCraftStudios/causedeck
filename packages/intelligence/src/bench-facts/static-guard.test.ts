// Static guard (#521, D-050): no field, query or string for ratings, rankings, comparisons between
// judges, outcome rates (grant, dismissal or bail percentages), predictions or sentiment in the
// bench-facts code, the bench card, its route or its flag text. Comments are not scanned: they may
// say what the code must never do.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const PROHIBITED =
  /rating|ranking|\brank|compar(?:e|ison)|outcome[\s_-]?rate|(?:grant|dismissal|bail)[\s_-]?(?:rate|percent)|percent|predict|sentiment/i;

const FILES = [
  'packages/db/src/schema/bench-facts.ts',
  'packages/db/migrations/0082_bench_facts.sql',
  'packages/intelligence/src/bench-facts/index.ts',
  'packages/core/src/court-day/bench-card.ts',
  'apps/api/src/routes/v1/bench-card.ts',
];

const stripComments = (source: string): string =>
  source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*(?:\/\/|--).*$/gm, '')
    .replaceAll(/\s(?:\/\/|--)\s.*$/gm, '');

/** Lines of `source` that match the prohibited pattern once comments are removed. */
export function offenders(source: string): string[] {
  return stripComments(source)
    .split('\n')
    .filter((line) => PROHIBITED.test(line));
}

const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

describe('bench facts: no rating, ranking, comparison, outcome-rate or prediction', () => {
  it.each(FILES)('%s is clean', (file) => {
    expect(offenders(read(file))).toEqual([]);
  });

  it('the bench_facts flag text is clean', () => {
    const keys = read('packages/flags/src/keys.ts');
    const start = keys.indexOf('bench_facts: flag(');
    expect(start).toBeGreaterThan(-1);
    const block = keys.slice(start, keys.indexOf('),', start));
    expect(offenders(block)).toEqual([]);
  });

  it('fails on a planted offender (mutation case)', () => {
    for (const planted of [
      'const judgeRanking = 1;',
      "const label = 'grant rate';",
      'export function predictOutcome() {}',
      'const sentimentScore = 0;',
      'const compareJudges = 1;',
      'const bail_percent = 3;',
    ]) {
      expect(offenders(`${read(FILES[0] ?? '')}\n${planted}\n`)).toEqual([planted]);
    }
    expect(offenders('// ranking is prohibited\nconst a = 1;')).toEqual([]);
  });
});
