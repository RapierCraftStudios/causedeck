// Route warm-up for the per-worker `next start` servers (#995). The e2e build is already compiled,
// but a fresh server still pays for its first request to every route: lazy loading of the route's
// server chunks, the first database connections of the pool, the session lookup. Under two
// parallel workers on a shared runner that first hit took long enough to trip 30 s test timeouts,
// "Something went wrong" error boundaries and CONNECT_TIMEOUT on cold pages (about 15 flaky tests
// per shard). Warming every static workspace page once, before the first test, moves that cost out
// of the timed specs. It never weakens an assertion: tests still run against the same build.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { originFor } from './server-pool.ts';

/** Static pages under `/w/<slug>/` (no dynamic segments); see apps/web/app/(app)/w/[slug]. */
export const WARM_WORKSPACE_PATHS: readonly string[] = [
  'today',
  'tomorrow',
  'matters',
  'courts',
  'courts/rosters',
  'courts/rosters/import',
  'courts/insights',
  'briefs',
  'calendar',
  'inbox',
  'inbox/import/whatsapp',
  'people',
  'people/enquiries',
  'memory',
  'memory/playbooks',
  'memory/review',
  'memory/precedents',
  'drafts',
  'invoices',
  'invoices/new',
  'insights',
  'insights/report',
  'obligations',
  'limitation',
  'notices',
  'activity',
  'research',
  'updates',
  'news',
  'portfolio',
  'import',
  'help',
  'billing',
  'settings',
  'settings/profile',
  'settings/members',
  'settings/roles',
  'settings/notifications',
  'settings/audit',
  'settings/usage',
  'settings/privacy',
  'settings/export',
  'settings/danger',
  'settings/integrations',
  'settings/integrations/calendar',
  'settings/integrations/email',
  'settings/court-watch',
  'settings/case-watch',
  'settings/research',
  'settings/support',
  'settings/sso',
];

const CONCURRENCY = 4;
const PER_REQUEST_MS = 20_000;
const WARM_WORKSPACE = 'chennai-solo';
/** The owner session saved by global-setup.ts (same path as fixtures/auth.ts `storageStatePath`). */
const OWNER_STATE = path.join(
  fileURLToPath(new URL('../.auth', import.meta.url)),
  `${WARM_WORKSPACE}-owner.json`,
);

function cookieHeader(): string {
  const state = JSON.parse(readFileSync(OWNER_STATE, 'utf8')) as {
    cookies?: { name: string; value: string }[];
  };
  return (state.cookies ?? []).map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * GET every warm path (and the public sign-in page) on the server at `port`, signed in as the
 * seeded owner of chennai-solo. Best effort: a failed or slow request is ignored (the tests are the
 * check) and the whole pass is bounded by `budgetMs`.
 */
export async function warmServer(port: number, budgetMs = 60_000): Promise<void> {
  const origin = originFor(port);
  let cookie = '';
  try {
    cookie = cookieHeader();
  } catch {
    // No saved session (a run without global setup): warm the public pages only.
  }
  const urls = [
    `${origin}/sign-in`,
    ...(cookie ? WARM_WORKSPACE_PATHS.map((p) => `${origin}/w/${WARM_WORKSPACE}/${p}`) : []),
  ];
  const deadline = Date.now() + budgetMs;
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < urls.length && Date.now() < deadline) {
      const url = urls[next++] as string;
      try {
        const response = await fetch(url, {
          headers: { cookie, origin },
          signal: AbortSignal.timeout(PER_REQUEST_MS),
        });
        await response.arrayBuffer();
      } catch {
        // Best effort.
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
}
