// Document upload bursts (#105). Storage and intelligence are mocks (MinIO, AI_PROVIDER=mock):
// nothing leaves the local stack.
import http from 'k6/http';
import { sleep } from 'k6';

import { BASE_URL, guardTarget, signIn } from '../lib/auth.ts';
import { workspaceFor } from '../lib/seed-users.ts';
import { thresholds } from '../thresholds.ts';

declare const __VU: number;
declare const __ITER: number;

export const options = {
  scenarios: {
    bursts: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 60,
      stages: [
        { duration: '1m', target: 2 },
        { duration: '30s', target: 15 },
        { duration: '1m', target: 2 },
      ],
    },
  },
  thresholds,
};

// A tiny synthetic text document: the burst tests the request path, not the bytes.
const SAMPLE = 'SYNTHETIC - DEMO DATA - FICTIONAL\nOrder sheet placeholder.\n';

export function setup(): void {
  guardTarget();
}

export default function (): void {
  const workspace = workspaceFor(__VU);
  if (__ITER === 0) signIn(workspace);
  http.post(
    `${BASE_URL}/w/${workspace.slug}/import`,
    { file: http.file(SAMPLE, 'synthetic-order.txt', 'text/plain') },
    { tags: { group: 'action' } },
  );
  sleep(0.2);
}
