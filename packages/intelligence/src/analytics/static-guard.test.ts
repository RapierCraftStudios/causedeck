// Static guard (#512, D-050): user-facing court analytics have no judge, bench or party dimension,
// column, parameter or string, and never read the internal bench stores. Comments are not scanned:
// they may say what the code must never do.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const PROHIBITED = /judge|bench|justice|coram|petitioner|respondent|\bparty|parties/i;
const INTERNAL_STORES =
  /benchSittingFact|boardObservation|schema\.bench|bench_sitting_fact|board_observation/;

const FILES = [
  'packages/intelligence/src/analytics/index.ts',
  'packages/intelligence/src/analytics/timeline.ts',
  'apps/web/components/matters/expected-timeline-card.tsx',
  'apps/web/app/(app)/w/[slug]/courts/insights/page.tsx',
  'apps/web/components/courts/court-insights.tsx',
  'packages/i18n/src/messages/en/court-insights.json',
];

const stripComments = (source: string): string =>
  source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*(?:\/\/|--).*$/gm, '')
    .replaceAll(/\s\/\/\s.*$/gm, '');

/** Lines of `source` that match `pattern` once comments are removed. */
export function offenders(source: string, pattern: RegExp = PROHIBITED): string[] {
  return stripComments(source)
    .split('\n')
    .filter((line) => pattern.test(line));
}

const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

describe('court analytics: no judge, bench or party dimension', () => {
  it.each(FILES)('%s is clean', (file) => {
    expect(offenders(read(file))).toEqual([]);
  });

  it('the analytics query never reads an internal bench or board store', () => {
    expect(offenders(read(FILES[0] ?? ''), INTERNAL_STORES)).toEqual([]);
  });

  it('fails on a planted offender (mutation case)', () => {
    for (const planted of [
      'const judgeId = 1;',
      "const label = 'bench composition';",
      'export const byJudge = {};',
      'const titlePetitioner = 1;',
      'const partyName = 1;',
    ]) {
      expect(offenders(planted)).toHaveLength(1);
    }
    expect(offenders('.from(schema.benchSittingFact)', INTERNAL_STORES)).toHaveLength(1);
    expect(offenders('// a judge dimension is never allowed')).toEqual([]);
  });
});
