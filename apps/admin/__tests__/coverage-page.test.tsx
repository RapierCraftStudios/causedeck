// The Coverage page (#517): every forum of the catalogue shows a level per data type, the state
// filter narrows the matrix and the gap list, the gaps come in the ranked order, and a support role
// is refused (the data layer's capability check).
import {
  COVERAGE_DATA_TYPES,
  buildCoverage,
  rankGaps,
  type CoverageInputs,
} from '@causedeck/core/sources';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-10-26T00:00:00Z');
const forums = [
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
  {
    code: 'in.ka.karnataka-hc.bengaluru',
    court: 'Karnataka HC',
    establishment: null,
    jurisdictionKind: 'high_court',
  },
];
const inputs: CoverageInputs = {
  forums,
  sources: [
    {
      id: 'in.ka.district:case_status',
      kind: 'court',
      accessMode: 'A1',
      clearedAt: new Date('2026-09-01'),
      killSwitch: false,
    },
  ],
  fetches: [{ sourceId: 'in.ka.district:case_status', lastSuccessAt: NOW, successes7d: 6 }],
  notices: [],
  demand: [{ sourceId: 'in.ka.district:case_status', watches: 9, users: 3 }],
};
const coverage = buildCoverage(inputs);

const state = vi.hoisted(() => ({ role: 'ops' as string }));
vi.mock('../lib/staff.ts', () => ({
  requireStaff: (capability: string) => {
    if (capability !== 'coverage') throw new Error('wrong capability');
    return Promise.resolve({ userId: 'u', email: 'e', role: state.role });
  },
}));
vi.mock('../lib/data/index.ts', () => ({
  coverageOverview: () => Promise.resolve({ coverage, gaps: rankGaps(coverage), changes: [] }),
}));

const { default: CoveragePage } = await import('../app/(console)/coverage/page.tsx');
const { canStaff } = await import('../lib/roles.ts');

const render = async (state?: string): Promise<string> =>
  renderToStaticMarkup(await CoveragePage({ searchParams: Promise.resolve({ state }) }));

describe('Coverage page', () => {
  it('lists every forum with a level cell per data type', async () => {
    const html = await render();
    for (const f of forums) {
      const row = html.split(`data-forum="${f.code}"`)[1]?.split('</tr>')[0] ?? '';
      expect(row.match(/data-level="/g)).toHaveLength(COVERAGE_DATA_TYPES.length);
    }
    expect(html).toContain('data-level="A1"');
  });

  it('filters by state, matrix and gaps', async () => {
    const html = await render('tn');
    expect(html).toContain('data-forum="in.tn.chennai.small-causes"');
    expect(html).not.toContain('data-forum="in.ka.bengaluru.family-court"');
    expect(html).not.toContain('in.ka.karnataka-hc.bengaluru ·');
  });

  it('ranks the gap list by demand', async () => {
    const html = await render('ka');
    const gaps = html.split('aria-label="Gap list"')[1] ?? '';
    expect(gaps.indexOf('in.ka.bengaluru.family-court · case_status')).toBeGreaterThan(-1);
    expect(gaps.indexOf('in.ka.bengaluru.family-court · case_status')).toBeLessThan(
      gaps.indexOf('in.ka.karnataka-hc.bengaluru · case_status'),
    );
  });

  it('is not reachable by support staff', () => {
    expect(canStaff('support', 'coverage')).toBe(false);
    expect(canStaff('ops', 'coverage')).toBe(true);
  });
});
