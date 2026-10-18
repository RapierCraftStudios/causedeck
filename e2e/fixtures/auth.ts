// `asUser(role)` (#16): a page already signed in as the seeded user holding `role`. Sessions are
// minted once per run in global-setup.ts through the dev sign-in provider (`POST
// /api/auth/dev/sign-in`, never present in production builds) and live in the template database,
// so every worker clone already knows them; the fixture only loads the saved cookies.
// Magic links: worker servers send mail to the dev stack's Mailpit, read back via its API.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContextOptions, Page } from '@playwright/test';

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
});
