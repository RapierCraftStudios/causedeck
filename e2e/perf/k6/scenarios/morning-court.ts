// Morning peak (07:00-10:30 IST, #105): the court-day board, the offline cache sync and hearing capture.
import http from 'k6/http';
import { sleep } from 'k6';

import {
  BASE_URL,
  crossTenantProbe,
  get,
  guardTarget,
  pollReadiness,
  signIn,
} from '../lib/auth.ts';
import { workspaceFor } from '../lib/seed-users.ts';
import { thresholds } from '../thresholds.ts';

declare const __ENV: Record<string, string | undefined>;
declare const __VU: number;
declare const __ITER: number;

export const options = {
  scenarios: {
    morning: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: 40 },
        { duration: '6m', target: 100 },
        { duration: '1m', target: 0 },
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
  get(workspace, '/today', 'court_day_cache');
  // The service worker's offline cache sync reads the same board data for the day.
  http.get(`${BASE_URL}/w/${workspace.slug}/today?sync=offline`, {
    tags: { group: 'court_day_cache' },
  });
  get(workspace, '/hearings', 'read');
  if (__ITER % 10 === 0) crossTenantProbe(workspace, '/today');
  if (__ITER % 20 === 0) pollReadiness();
  sleep(Number(__ENV.PERF_THINK_SECONDS ?? 1));
}
