// The plan engine (#548), no database: identifiers, the matched-only filter, clustering, date rules,
// determinism, golden plans on the synthetic bundles, plan build time and filter accuracy.
import { parseAdvocate } from '@causedeck/adapters';
import { describe, expect, it } from 'vitest';

import { buildPlanFromDrafts, istDay } from '../bootstrap.ts';
import { clusterProceedings, type ClusterNode } from '../cluster.ts';
import { filterMatchedRows } from '../filter-rows.ts';
import { bengaluruChamber, chennaiSolo, draft, SECRET, type Bundle } from '../fixtures/bundles.ts';
import { getAdvocateIdentifiers, hasIdentifiers } from '../identifiers.ts';

function summarise(bundle: Bundle) {
  const { plan } = buildPlanFromDrafts(bundle.drafts, bundle.identifiers, bundle.today);
  return {
    plan,
    matters: plan.matters.map((matter) => ({
      keys: matter.proceedings.map((p) => p.key),
      reason: matter.reason,
      confidence: matter.confidence,
      next: matter.nextDate?.date ?? null,
      issues: matter.issues.map((issue) => issue.code),
    })),
    history: plan.history.map((h) => ({ proceedingKey: h.proceedingKey, date: h.date })),
  };
}

describe('getAdvocateIdentifiers', () => {
  it('normalises enrolment numbers and name aliases', () => {
    const ids = getAdvocateIdentifiers({
      enrolmentNumbers: [' ms / 123 / 1900 ', 'MS/123/1900'],
      aliases: ['Mr. R. Fictional, Adv.'],
    });
    expect(ids.enrolmentNumbers).toEqual(['MS/123/1900']);
    expect(ids.aliases).toContain('R FICTIONAL');
    expect(ids.aliases).toContain('FICTIONAL R');
    expect(hasIdentifiers(getAdvocateIdentifiers({}))).toBe(false);
  });
});

describe('filterMatchedRows', () => {
  const ids = getAdvocateIdentifiers({
    enrolmentNumbers: ['MS/123/1900'],
    aliases: ['R. Fictional'],
  });

  it('keeps a row by enrolment number or by alias, and counts the rest', () => {
    const rows = [
      { advocates: [parseAdvocate('Mr. A. Other MS/123/1900')] },
      { advocates: [parseAdvocate('R. Fictional')] },
      { advocates: [parseAdvocate('Mr. Z. Stranger MS/999/1900')] },
      { advocates: [] },
      {},
    ];
    const { matched, unmatchedCount } = filterMatchedRows(rows, ids);
    expect(matched).toHaveLength(2);
    expect(unmatchedCount).toBe(3);
  });

  it('does not match a longer name that merely contains an alias', () => {
    const { matched } = filterMatchedRows([{ advocates: [parseAdvocate('R. Fictionalson')] }], ids);
    expect(matched).toEqual([]);
  });

  it('keeps nothing without identifiers', () => {
    const { matched, unmatchedCount } = filterMatchedRows(
      [{ advocates: [parseAdvocate('R. Fictional')] }],
      getAdvocateIdentifiers({}),
    );
    expect(matched).toEqual([]);
    expect(unmatchedCount).toBe(1);
  });
});

describe('clusterProceedings', () => {
  const node = (key: string, extra: Partial<ClusterNode> = {}): ClusterNode => ({
    key,
    parentKey: null,
    connectedKeys: [],
    cnr: null,
    lowerCourtRef: null,
    label: null,
    partyKeys: [],
    ...extra,
  });

  it('makes a single-proceeding group for an unlinked proceeding', () => {
    expect(clusterProceedings([node('A')])).toEqual([
      { keys: ['A'], confidence: 1, reason: 'single proceeding' },
    ]);
  });

  it('ignores a parent or connected key that is not in the batch', () => {
    const groups = clusterProceedings([node('A', { parentKey: 'X', connectedKeys: ['Y'] })]);
    expect(groups).toHaveLength(1);
  });

  it('does not depend on input order', () => {
    const nodes = [
      node('C', { parentKey: 'A' }),
      node('A'),
      node('B', { lowerCourtRef: 'A' }),
      node('D'),
    ];
    expect(clusterProceedings(nodes)).toEqual(clusterProceedings([...nodes].reverse()));
  });
});

describe('golden plans', () => {
  it.each([
    ['Chennai solo', chennaiSolo],
    ['Bengaluru chamber', bengaluruChamber],
  ])('%s', (_name, make) => {
    const bundle = make();
    const result = summarise(bundle);
    expect(result.matters).toEqual(bundle.expected.matters);
    expect(result.history).toEqual(bundle.expected.history);
    expect(result.plan.counts).toEqual(bundle.expected.counts);
  });

  it('is deterministic: the same inputs, in any order, give identical JSON', () => {
    const bundle = chennaiSolo();
    const first = JSON.stringify(summarise(bundle).plan);
    const reversed = { ...bundle, drafts: [...bundle.drafts].reverse() };
    expect(JSON.stringify(summarise(reversed).plan)).toBe(first);
    expect(JSON.stringify(summarise(bundle).plan)).toBe(first);
  });

  it('never carries a non-matched row anywhere in the plan JSON', () => {
    for (const bundle of [chennaiSolo(), bengaluruChamber()]) {
      expect(JSON.stringify(summarise(bundle).plan)).not.toContain(SECRET);
    }
  });

  it('imports no list rows without identifiers', () => {
    const bundle = chennaiSolo();
    const { plan } = buildPlanFromDrafts(bundle.drafts, getAdvocateIdentifiers({}), bundle.today);
    expect(plan.matters).toEqual([]);
    expect(plan.counts).toEqual({ matchedRows: 0, unmatchedRowsCount: bundle.drafts.length });
  });
});

describe('date rules', () => {
  const ids = getAdvocateIdentifiers({ aliases: ['R. Fictional'] });
  const row = (listDate: string, extra: Record<string, unknown> = {}) =>
    draft(
      { matchKey: 'WP/1/2026', advocates: [parseAdvocate('R. Fictional')], listDate, ...extra },
      { kind: 'listing_update' },
    );

  it('treats today (IST) as a next date and yesterday as history', () => {
    const today = '2026-11-10';
    const { plan } = buildPlanFromDrafts([row(today)], ids, today);
    expect(plan.matters[0]?.nextDate?.date).toBe(today);
    expect(plan.matters[0]?.nextDate?.sources[0]?.anchorIds).toHaveLength(1);
    const past = buildPlanFromDrafts([row('2026-11-09')], ids, today).plan;
    expect(past.matters[0]?.nextDate).toBeNull();
    expect(past.history.map((h) => h.date)).toEqual(['2026-11-09']);
  });

  it('keeps both conflicting future dates under a blocking issue', () => {
    const { plan } = buildPlanFromDrafts([row('2026-11-12'), row('2026-11-14')], ids, '2026-11-10');
    const [matter] = plan.matters;
    expect(matter?.nextDate).toBeNull();
    expect(matter?.proceedings[0]?.nextDateCandidates.map((d) => d.date)).toEqual([
      '2026-11-12',
      '2026-11-14',
    ]);
    expect(matter?.issues).toEqual([
      {
        code: 'conflicting_dates',
        blocking: true,
        proceedingKey: 'WP/1/2026',
        dates: ['2026-11-12', '2026-11-14'],
      },
    ]);
  });

  it('is not a conflict when two sources agree', () => {
    const { plan } = buildPlanFromDrafts([row('2026-11-12'), row('2026-11-12')], ids, '2026-11-10');
    expect(plan.matters[0]?.issues).toEqual([]);
    expect(plan.matters[0]?.nextDate?.sources).toHaveLength(2);
  });

  it('computes the IST calendar day', () => {
    expect(istDay(new Date('2026-11-09T19:00:00Z'))).toBe('2026-11-10');
    expect(istDay(new Date('2026-11-09T18:29:00Z'))).toBe('2026-11-09');
  });
});

describe('accuracy and speed', () => {
  it('builds a plan for 300 proceedings with p95 under 2 s', () => {
    const me = parseAdvocate('Mr. R. Fictional MS/123/1900');
    const ids = getAdvocateIdentifiers({ enrolmentNumbers: ['MS/123/1900'] });
    const drafts = Array.from({ length: 300 }, (_, i) =>
      draft({
        matchKey: `WP/${String(i)}/2025`,
        advocates: [me],
        caseTypeRaw: 'W.P.',
        caseNumber: String(i),
        caseYear: 2025,
        parties: `P${String(Math.floor(i / 3))} V R`,
        parentProceedingKey: i % 10 === 9 ? `WP/${String(i - 1)}/2025` : null,
        listDate: '2026-11-12',
      }),
    );
    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      const start = performance.now();
      buildPlanFromDrafts(drafts, ids, '2026-11-10');
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95) - 1] ?? Infinity).toBeLessThan(2000);
  });

  it('reaches precision >= 99.5% and recall >= 95% on labelled rows', () => {
    const ids = getAdvocateIdentifiers({
      enrolmentNumbers: ['MS/123/1900'],
      aliases: ['R. Fictional'],
    });
    const rows = Array.from({ length: 1000 }, (_, i) => {
      const mine = i % 5 === 0;
      const advocates = mine
        ? [parseAdvocate(i % 10 === 0 ? 'Mr. X. Colleague MS/123/1900' : 'Mr. R. Fictional')]
        : [
            parseAdvocate(
              `Mr. N${'ABCDEFGHIJ'[i % 10] ?? 'Z'}. Stranger MS/${String(200 + i)}/1990`,
            ),
          ];
      return { mine, advocates };
    });
    const { matched } = filterMatchedRows(rows, ids);
    const truePositives = matched.filter((row) => row.mine).length;
    const precision = truePositives / matched.length;
    const recall = truePositives / rows.filter((row) => row.mine).length;
    expect(precision).toBeGreaterThanOrEqual(0.995);
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });
});
