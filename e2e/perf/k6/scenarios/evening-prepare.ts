// Evening peak (18:00-23:00 IST, #105): advocates prepare for tomorrow: briefs, obligations, the
// court-day board and memory proposals and the inbox. The shape is compressed: PERF_SCALE stretches it.
import { sleep } from 'k6';

import { crossTenantProbe, get, guardTarget, pollReadiness, signIn } from '../lib/auth.ts';
import { workspaceFor } from '../lib/seed-users.ts';
import { thresholds } from '../thresholds.ts';

declare const __ENV: Record<string, string | undefined>;
declare const __VU: number;
declare const __ITER: number;

export const options = {
  scenarios: {
    evening: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: 20 },
        { duration: '6m', target: 60 },
        { duration: '2m', target: 0 },
      ],
    },
  },
  thresholds,
};

export function setup(): void {
  guardTarget();
}

export default function (): void {
  const workspace = workspaceFor(__VU);
  if (__ITER === 0) signIn(workspace);
  get(workspace, '/briefs', 'brief_assembly');
  get(workspace, '/obligations', 'read');
  get(workspace, '/today', 'court_day_cache');
  get(workspace, '/memory', 'read');
  // The capture inbox with 200 seeded items (`perf:seed`): group `inbox`, p95 under 300 ms.
  get(workspace, '/inbox', 'inbox');
  if (__ITER % 10 === 0)
    crossTenantProbe(workspace, '/matters/00000000-0000-4000-8000-000000000001');
  if (__ITER % 20 === 0) pollReadiness();
  sleep(Number(__ENV.PERF_THINK_SECONDS ?? 1));
}
