// `asUser(role)` (#16): a page already signed in as the seeded user holding `role`. Sessions are
// minted once per run in global-setup.ts through the dev sign-in provider (`POST
// /api/auth/dev/sign-in`, never present in production builds) and live in the template database,
// so every worker clone already knows them; the fixture only loads the saved cookies.
// Magic links: worker servers send mail to the dev stack's Mailpit, read back via its API.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContextOptions, Page } from '@playwright/test';
import postgres from 'postgres';

import { databaseUrl } from '../support/db-reset.ts';
import { MAILPIT_URL } from '../support/server-pool.ts';

import { test as dbTest } from './db.ts';
import { e2eUser, gotoWorkspace, type E2eRole, type E2eWorkspaceSlug } from './workspace.ts';

/** `e2e/.auth/` (gitignored). */
export const AUTH_DIR = fileURLToPath(new URL('../.auth', import.meta.url));

export function storageStatePath(workspace: E2eWorkspaceSlug, role: E2eRole): string {
  return path.join(AUTH_DIR, `${workspace}-${role}.json`);
}

export interface AsUserOptions {
  workspace?: E2eWorkspaceSlug;
  /** Where to land after signing in, relative to the workspace (default `today`). */
  path?: string;
}

export type AsUser = (role: E2eRole, options?: AsUserOptions) => Promise<Page>;

export interface AuthFixtures {
  asUser: AsUser;
  /**
   * The magic link most recently emailed to `email` by this worker's server during this test, read
   * from the Mailpit API (the console mailer's log redacts the token, by design).
   */
  readMagicLink: (email: string) => Promise<string>;
  /**
   * The six-digit code the worker's server most recently issued to `phone` (E.164). The console SMS
   * sender only logs it, so the helper reads it from the worker database, where Better Auth's
   * phone-number plugin keeps it as `verification.value = '<code>:<attempts>'` under the phone as
   * identifier. Nothing is added to the app for this, so there is no test-only path to disable in
   * production.
   */
  readPhoneOtp: (phone: string) => Promise<string>;
  /** Move the pending code for `phone` into the past, as if its five minutes had run out. */
  expirePhoneOtp: (phone: string) => Promise<void>;
}

type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

interface MailpitSummary {
  ID: string;
  Created: string;
}

async function mailpit<T>(pathAndQuery: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${pathAndQuery}`);
  if (!response.ok) throw new Error(`e2e: Mailpit ${pathAndQuery}: ${String(response.status)}`);
  return (await response.json()) as T;
}

export const test = dbTest.extend<AuthFixtures>({
  asUser: async ({ page }, use) => {
    await use(async (role, { workspace = 'chennai-solo', path: to = 'today' } = {}) => {
      const user = e2eUser(role, workspace);
      const state = JSON.parse(
        readFileSync(storageStatePath(user.workspace, user.role), 'utf8'),
      ) as StorageState;
      await page.context().clearCookies();
      await page.context().addCookies(state.cookies);
      await gotoWorkspace(page, workspace, to);
      return page;
    });
  },
  readMagicLink: async ({ workerServer }, use) => {
    const testStart = Date.now() - 1000;
    await use(async (email) => {
      // Workers share Mailpit; only this worker's server puts its own origin in the link.
      const pattern = new RegExp(`${workerServer.url}/api/auth/magic-link/verify\\S*`);
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const { messages } = await mailpit<{ messages: MailpitSummary[] }>(
          `/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=20`,
        );
        for (const summary of messages.filter((m) => Date.parse(m.Created) >= testStart)) {
          const { Text } = await mailpit<{ Text: string }>(`/api/v1/message/${summary.ID}`);
          const match = pattern.exec(Text);
          if (match) return match[0];
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(`e2e: no magic link for ${email} in Mailpit (${MAILPIT_URL})`);
    });
  },
  readPhoneOtp: async ({ workerDb }, use) => {
    await use(async (phone) => {
      const sql = postgres(databaseUrl(workerDb.name, 'owner'), { max: 1, connect_timeout: 5 });
      try {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const rows = await sql<{ value: string }[]>`
            select value from verification where identifier = ${phone}
            order by created_at desc limit 1`;
          const code = /^(\d{6}):\d+$/.exec(rows[0]?.value ?? '')?.[1];
          if (code) return code;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        throw new Error(`e2e: no phone OTP for ${phone} in ${workerDb.name}`);
      } finally {
        await sql.end();
      }
    });
  },
  expirePhoneOtp: async ({ workerDb }, use) => {
    await use(async (phone) => {
      const sql = postgres(databaseUrl(workerDb.name, 'owner'), { max: 1, connect_timeout: 5 });
      try {
        await sql`update verification set expires_at = now() - interval '1 minute'
          where identifier = ${phone}`;
      } finally {
        await sql.end();
      }
    });
  },
});
