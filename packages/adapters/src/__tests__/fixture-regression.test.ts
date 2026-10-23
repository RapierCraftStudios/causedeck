// The fixture regression gate (#516): every committed cause-list fixture of every workbench adapter
// is parsed, the per-source accuracy is printed, and a drop below fixtures/accuracy-baseline.json
// fails the run. A parser change that lowers accuracy therefore blocks the merge.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AccuracyBaselineSchema,
  checkBaseline,
  formatAccuracy,
  summarizeAccuracy,
  type SourceAccuracy,
} from '../testing/accuracy.ts';
import { FIXTURES_ROOT, runGolden } from '../testing/golden.ts';
import { WORKBENCH_ADAPTERS } from '../workbench/index.ts';
import type { CourtAdapter } from '../types.ts';

const baseline = AccuracyBaselineSchema.parse(
  JSON.parse(readFileSync(path.join(FIXTURES_ROOT, 'accuracy-baseline.json'), 'utf8')),
);

async function accuracyOf(adapterId: string, adapter?: CourtAdapter): Promise<SourceAccuracy> {
  const make = WORKBENCH_ADAPTERS[adapterId];
  if (make === undefined) throw new Error(`no workbench adapter ${adapterId}`);
  return summarizeAccuracy(
    await runGolden(adapterId, { adapter: adapter ?? make(), privateFixturesDir: null }),
  );
}

describe('fixture accuracy baseline', () => {
  it('has an entry for exactly the workbench adapters', () => {
    expect(Object.keys(baseline).sort()).toEqual(Object.keys(WORKBENCH_ADAPTERS).sort());
  });

  it('is met by every source, with no drop', async () => {
    const accuracy = await Promise.all(Object.keys(WORKBENCH_ADAPTERS).map((id) => accuracyOf(id)));
    console.log(formatAccuracy(accuracy));
    expect(checkBaseline(accuracy, baseline)).toEqual([]);
  });

  it('fails when a parser change lowers accuracy', async () => {
    const adapter = WORKBENCH_ADAPTERS.echo?.();
    if (adapter === undefined) throw new Error('echo adapter missing');
    // A regression: the parser loses the first row of every list.
    const degraded: CourtAdapter = {
      ...adapter,
      parseCauseList: async (input) => {
        const parsed = await adapter.parseCauseList(input);
        return { ...parsed, rows: parsed.rows.slice(1) };
      },
    };
    const drops = checkBaseline([await accuracyOf('echo', degraded)], baseline);
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.join('\n')).toMatch(/echo: caseRate/);
  });

  it('names a source that has no baseline entry', () => {
    const [drop] = checkBaseline(
      [{ adapterId: 'new.source', cases: 1, passed: 1, caseRate: 1, precision: 1, recall: 1 }],
      baseline,
    );
    expect(drop).toBe('new.source: no entry in accuracy-baseline.json');
  });
});
