// Matters list budget (#394, #40): p95 server render under 300 ms on the seeded workspace of 500
// matters and 1,500 proceedings (fixtures/matters-data.ts). The route's 25 KB gzip share of the JS
// budget is enforced by `pnpm --filter @causedeck/web bundle:budget` (scripts/check-bundle-budget.mjs,
// tests in apps/web/__tests__/bundle-budget.test.ts), and Lighthouse by `lhci:matters`; neither is
// repeated here.
//
// Server render is the time to receive the whole signed-in HTML response for the first page of the
// list, after a warm-up, over repeated requests (the app's wall-clock: this runs on a shared CI
// runner, so the sample count and warm-up are generous).
import { performance } from 'node:perf_hooks';

import {
  MATTERS_WORKSPACE,
  PERF_MATTERS,
  PERF_PROCEEDINGS_PER_MATTER,
} from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';

import { withSql } from '../lifecycle/helpers.ts';

import { openMatters } from './helpers.ts';

const BUDGET_MS = 300;
const WARMUP = 5;
const SAMPLES = 30;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

test.describe('matters list budget', { tag: '@perf' }, () => {
  test(`p95 server render under ${String(BUDGET_MS)} ms on ${String(PERF_MATTERS)} matters`, async ({
    page,
    asUser,
    db,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'perf-1280-light', 'timing runs once, on desktop, alone');
    await openMatters(page, asUser);
    const counts = await withSql(db.name, async (sql) => {
      const [row] = await sql<{ matters: string; proceedings: string }[]>`
        select (select count(*) from matter where title like 'Perf matter %') as matters,
               (select count(*) from proceeding where case_type_code = 'WP' and year = 2023)
                 as proceedings`;
      return row;
    });
    expect(Number(counts?.matters)).toBe(PERF_MATTERS);
    expect(Number(counts?.proceedings)).toBe(PERF_MATTERS * PERF_PROCEEDINGS_PER_MATTER);

    const url = `/w/${MATTERS_WORKSPACE}/matters`;
    const timeOne = async (): Promise<number> => {
      const start = performance.now();
      const response = await page.request.get(url);
      await response.body();
      const elapsed = performance.now() - start;
      expect(response.ok()).toBe(true);
      return elapsed;
    };
    for (let i = 0; i < WARMUP; i += 1) await timeOne();
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) samples.push(await timeOne());
    const value = p95(samples);
    expect(
      value,
      `list render p95 ${value.toFixed(0)} ms over ${String(SAMPLES)} requests`,
    ).toBeLessThan(BUDGET_MS);
  });
});
