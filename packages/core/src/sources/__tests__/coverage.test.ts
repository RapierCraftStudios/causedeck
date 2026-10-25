// The coverage model (#517): the source-to-forum rule, levels, freshness and volume, that every
// catalogue forum has a cell per data type, that the gap ranking follows live watch counts, and the
// week-over-week change.
import { describe, expect, it } from 'vitest';

import {
  COVERAGE_DATA_TYPES,
  buildCoverage,
  coverageReport,
  diffCoverage,
  rankGaps,
  sourceCoversForum,
  type CoverageInputs,
  type CoverageSource,
} from '../coverage.ts';

const NOW = new Date('2026-10-26T00:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY);

const forums = [
  {
    code: 'in.ka.karnataka-hc.bengaluru',
    court: 'Karnataka HC',
    establishment: null,
    jurisdictionKind: 'high_court',
  },
  {
    code: 'in.ka.bengaluru.family-court',
    court: 'Family',
    establishment: null,
    jurisdictionKind: 'district',
  },
  {
    code: 'in.tn.chennai.small-causes',
    court: 'Small causes',
    establishment: null,
    jurisdictionKind: 'district',
  },
];

const src = (id: string, over: Partial<CoverageSource> = {}): CoverageSource => ({
  id,
  kind: 'court',
  accessMode: 'A1',
  clearedAt: daysAgo(30),
  killSwitch: false,
  ...over,
});

function inputs(over: Partial<CoverageInputs> = {}): CoverageInputs {
  return { forums, sources: [], fetches: [], notices: [], demand: [], ...over };
}

describe('sourceCoversForum', () => {
  it('matches the forum code, a dotted ancestor and the state district source', () => {
    const [hc, ka, tn] = forums as [(typeof forums)[0], (typeof forums)[0], (typeof forums)[0]];
    expect(sourceCoversForum('in.ka.karnataka-hc.bengaluru:cause_list', hc, 'cause_list')).toBe(
      true,
    );
    expect(sourceCoversForum('in.ka.karnataka-hc:cause_list', hc, 'cause_list')).toBe(true);
    expect(sourceCoversForum('in.ka.karnataka-hc.bengaluru:cause_list', hc, 'case_status')).toBe(
      false,
    );
    expect(sourceCoversForum('in.ka.district:case_status', ka, 'case_status')).toBe(true);
    expect(sourceCoversForum('in.ka.district:case_status', tn, 'case_status')).toBe(false);
    expect(sourceCoversForum('in.ka.district:case_status', hc, 'case_status')).toBe(false);
    expect(sourceCoversForum('in.ka.karnataka-hc.bengaluru2:cause_list', hc, 'cause_list')).toBe(
      false,
    );
  });
});

describe('buildCoverage', () => {
  it('gives every catalogue forum a level for every data type', () => {
    const rows = buildCoverage(inputs());
    expect(rows.map((r) => r.forum.code)).toEqual(forums.map((f) => f.code).sort());
    for (const row of rows) {
      expect(Object.keys(row.cells).sort()).toEqual([...COVERAGE_DATA_TYPES].sort());
      for (const type of COVERAGE_DATA_TYPES) expect(row.cells[type].level).toBe('none');
    }
  });

  it('takes the highest level of cleared, live sources and reports freshness and volume', () => {
    const rows = buildCoverage(
      inputs({
        sources: [
          src('in.ka.district:case_status', { accessMode: 'A0' }),
          src('in.ka.bengaluru.family-court:case_status', { accessMode: 'A2' }),
          src('in.ka.bengaluru.family-court:cause_list', { clearedAt: null }),
          src('in.ka.bengaluru.family-court:display_board', { killSwitch: true }),
        ],
        fetches: [
          { sourceId: 'in.ka.district:case_status', lastSuccessAt: daysAgo(2), successes7d: 3 },
          {
            sourceId: 'in.ka.bengaluru.family-court:case_status',
            lastSuccessAt: daysAgo(1),
            successes7d: 4,
          },
        ],
      }),
    );
    const family = rows.find((r) => r.forum.code === 'in.ka.bengaluru.family-court');
    expect(family?.cells.case_status).toMatchObject({
      level: 'A2',
      volume7d: 7,
      lastFetchedAt: daysAgo(1),
    });
    expect(family?.cells.cause_list.level).toBe('none');
    expect(family?.cells.display_board.level).toBe('none');
    expect(rows.find((r) => r.forum.code.startsWith('in.tn'))?.cells.case_status.level).toBe(
      'none',
    );
  });

  it('reads the notice cell from notices that name the forum', () => {
    const rows = buildCoverage(
      inputs({
        sources: [src('bci.notices', { kind: 'notice', accessMode: 'A1' })],
        notices: [
          {
            sourceId: 'bci.notices',
            forumCode: 'in.ka.karnataka-hc.bengaluru',
            latestAt: daysAgo(1),
            count7d: 2,
          },
        ],
      }),
    );
    expect(
      rows.find((r) => r.forum.code === 'in.ka.karnataka-hc.bengaluru')?.cells.notice,
    ).toMatchObject({ level: 'A1', volume7d: 2 });
  });
});

describe('rankGaps', () => {
  const sources = [
    src('in.ka.bengaluru.family-court:case_status', { accessMode: 'A0' }),
    src('in.tn.chennai.small-causes:case_status', { accessMode: 'A0' }),
  ];

  it('ranks by live watch demand times the levels missing', () => {
    const few = rankGaps(
      buildCoverage(
        inputs({
          sources,
          demand: [
            { sourceId: 'in.ka.bengaluru.family-court:case_status', watches: 2, users: 1 },
            { sourceId: 'in.tn.chennai.small-causes:case_status', watches: 20, users: 5 },
          ],
        }),
      ),
    );
    expect(few[0]).toMatchObject({
      forumCode: 'in.tn.chennai.small-causes',
      dataType: 'case_status',
      score: (20 + 5) * 3,
    });
    // The same catalogue with the demand reversed puts the other forum first.
    const flipped = rankGaps(
      buildCoverage(
        inputs({
          sources,
          demand: [
            { sourceId: 'in.ka.bengaluru.family-court:case_status', watches: 30, users: 9 },
            { sourceId: 'in.tn.chennai.small-causes:case_status', watches: 1, users: 1 },
          ],
        }),
      ),
    );
    expect(flipped[0]).toMatchObject({ forumCode: 'in.ka.bengaluru.family-court', score: 39 * 3 });
  });

  it('weights a missing source above a thin one and skips cells at A3', () => {
    const rows = buildCoverage(
      inputs({
        sources: [src('in.ka.district:case_status', { accessMode: 'A3' })],
        demand: [{ sourceId: 'in.ka.district:case_status', watches: 5, users: 5 }],
      }),
    );
    const gaps = rankGaps(rows);
    expect(
      gaps.some((g) => g.dataType === 'case_status' && g.forumCode.startsWith('in.ka.bengaluru')),
    ).toBe(false);
    expect(gaps.every((g) => g.score === 0)).toBe(true);
  });
});

describe('diffCoverage', () => {
  it('reports a source cleared in the last week as a level change', () => {
    const report = coverageReport(
      inputs({
        sources: [src('in.ka.district:case_status', { accessMode: 'A1', clearedAt: daysAgo(3) })],
      }),
      NOW,
    );
    expect(report.changes).toEqual([
      {
        forumCode: 'in.ka.bengaluru.family-court',
        dataType: 'case_status',
        from: 'none',
        to: 'A1',
      },
    ]);
    expect(diffCoverage(report.coverage, report.coverage)).toEqual([]);
  });

  it('reports nothing when the source was already cleared last week', () => {
    const report = coverageReport(inputs({ sources: [src('in.ka.district:case_status')] }), NOW);
    expect(report.changes).toEqual([]);
  });
});
