// Admin console fixtures (#309). Each Playwright worker that runs an admin spec starts one admin
// server (apps/admin, built once by the webServer step) on its own port, against the same worker
// database as its web server. The admin server has an IP allowlist (ADMIN_E2E_ALLOWLIST), and every
// admin request from these fixtures carries an allowed `X-Forwarded-For`, so a test can probe the
// allowlist by sending a different one.
//   - `adminServer` (worker): the running admin server;
//   - `adminAs(kind)`: a page signed in on the admin console as a seeded staff fixture, past the TOTP
//     step for enrolled staff unless `{ verify: false }`.
import type { Page } from '@playwright/test';

import {
  ADMIN_E2E_ALLOWED_IP,
  adminWorkerPort,
  startAdminServer,
  type RunningServer,
} from '../support/server-pool.ts';

import { ADMIN_FIXTURES, totpCode, type AdminFixture } from './admin-data.ts';
import { test as dbTest } from './db.ts';

export { ADMIN_FIXTURES, ADMIN_TOTP_SECRET, totpCode, type AdminFixture } from './admin-data.ts';

export const ALLOWED_HEADERS = { 'x-forwarded-for': ADMIN_E2E_ALLOWED_IP } as const;

export interface AdminWorkerFixtures {
  adminServer: RunningServer;
}

export interface AdminFixtures {
  adminAs: (kind: AdminFixture, options?: { verify?: boolean }) => Promise<Page>;
}

export const test = dbTest.extend<AdminFixtures, AdminWorkerFixtures>({
  adminServer: [
    async ({ workerDb }, use, workerInfo) => {
      const server = await startAdminServer(
        adminWorkerPort(workerInfo.parallelIndex),
        workerDb.url,
      );
      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { scope: 'worker', timeout: 90_000 },
  ],
  adminAs: async ({ browser, adminServer }, use) => {
    const pages: Page[] = [];
    await use(async (kind, { verify = true } = {}) => {
      const fixture = ADMIN_FIXTURES[kind];
      const context = await browser.newContext({
        baseURL: adminServer.url,
        extraHTTPHeaders: ALLOWED_HEADERS,
      });
      const page = await context.newPage();
      pages.push(page);
      const response = await page.request.post('/api/auth/dev/sign-in', {
        data: { email: fixture.email },
      });
      if (!response.ok()) {
        throw new Error(`e2e: admin dev sign-in for ${kind} failed (${String(response.status())})`);
      }
      if (verify && fixture.twoFactor && fixture.role !== null && kind !== 'disabled') {
        await page.goto('/verify-2fa');
        await page.getByLabel('Code').fill(totpCode());
        await page.getByRole('button', { name: 'Verify' }).click();
        await page.waitForURL((url) => url.pathname === '/');
      }
      return page;
    });
    for (const page of pages) await page.context().close();
  },
});
