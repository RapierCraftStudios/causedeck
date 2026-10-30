// 60-minute mixed soak (#105): both peaks and uploads together, with a readiness poll every
// iteration batch. Resource samples (DB CPU, connections, queue lag) come from the workflow's
// sampler; compare.ts turns them into the Stage B summary.
import { sleep } from 'k6';

import { crossTenantProbe, get, guardTarget, pollReadiness, signIn } from '../lib/auth.ts';
import { workspaceFor } from '../lib/seed-users.ts';
import { thresholds } from '../thresholds.ts';

declare const __ENV: Record<string, string | undefined>;
declare const __VU: number;
declare const __ITER: number;

const duration = __ENV.PERF_SOAK_DURATION ?? '60m';

export const options = {
  scenarios: {
    soak: { executor: 'constant-vus', vus: Number(__ENV.PERF_SOAK_VUS ?? 50), duration },
    readiness: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '5s',
      duration,
      preAllocatedVUs: 1,
      exec: 'readiness',
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
  get(workspace, '/today', 'court_day_cache');
  get(workspace, '/briefs', 'brief_assembly');
  get(workspace, '/obligations', 'read');
  if (__ITER % 10 === 0) crossTenantProbe(workspace, '/briefs');
  sleep(1);
}

export function readiness(): void {
  pollReadiness();
}
