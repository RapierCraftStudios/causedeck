// k6 helpers (#105): the target guard, magic-link sign-in through Mailpit, and the cross-tenant probe.
// k6 runs this file in its own runtime: `__ENV` replaces process.env.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

import { assertAllowedTarget } from '../../guard.ts';
import { otherWorkspace, type PerfWorkspace } from './seed-users.ts';

declare const __ENV: Record<string, string | undefined>;

export const BASE_URL = __ENV.PERF_BASE_URL ?? 'http://localhost:3100';
const MAILPIT_URL = __ENV.PERF_MAILPIT_URL ?? 'http://127.0.0.1:8025';

export const crossTenantLeaks = new Counter('cross_tenant_leaks');
export const readinessFlaps = new Counter('readiness_flaps');

/** Call from `setup()`: aborts the run before any request when the target is not allowed. */
export function guardTarget(): void {
  assertAllowedTarget(BASE_URL, __ENV);
  assertAllowedTarget(MAILPIT_URL, __ENV);
}

/** Sign `workspace`'s owner in through the real magic-link flow; the cookie jar keeps the session. */
export function signIn(workspace: PerfWorkspace): void {
  http.post(
    `${BASE_URL}/api/auth/sign-in/magic-link`,
    JSON.stringify({ email: workspace.ownerEmail, callbackURL: '/' }),
    { headers: { 'content-type': 'application/json' }, tags: { group: 'action' } },
  );
  const list = http.get(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${workspace.ownerEmail}`)}&limit=1`,
  );
  const id = (list.json('messages.0.ID') as string | null) ?? '';
  const body = http.get(`${MAILPIT_URL}/api/v1/message/${id}`).body as string;
  const link = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\S*/.exec(body)?.[0];
  if (link) http.get(link.replace(/&amp;/g, '&').replace(/["<>].*$/, ''));
}

/** Readiness poll: every failure is a flap. */
export function pollReadiness(): void {
  const response = http.get(`${BASE_URL}/readyz`, { tags: { group: 'read' } });
  if (!check(response, { 'readyz 200': (r) => r.status === 200 })) readinessFlaps.add(1);
}

/** A request for another workspace's id must come back 403 or 404, never 200. */
export function crossTenantProbe(own: PerfWorkspace, path: string): void {
  const other = otherWorkspace(own);
  const response = http.get(`${BASE_URL}/w/${other.slug}${path}`, {
    redirects: 0,
    tags: { group: 'read', probe: 'cross_tenant' },
  });
  if (response.status !== 403 && response.status !== 404) crossTenantLeaks.add(1);
}

/** Request `path` in the workspace under a route group tag. */
export function get(workspace: PerfWorkspace, path: string, group: string) {
  return http.get(`${BASE_URL}/w/${workspace.slug}${path}`, { tags: { group } });
}
