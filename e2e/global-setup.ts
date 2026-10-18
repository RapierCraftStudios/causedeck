// Runs once per `playwright test`, after the `webServer` (support/server-pool.ts serve) is up on
// E2E_PORT against the template database: build the template (init SQL, migrations, `e2e` seed),
// sign every seeded user in through the dev sign-in provider to save one `storageState` per role,
// then seal the template so the worker fixtures can clone it.
import { mkdirSync } from 'node:fs';

import { E2E_USERS } from '@causedeck/db/seed/e2e';
import { request } from '@playwright/test';

import { AUTH_DIR, storageStatePath } from './fixtures/auth.ts';
import { assertStackUp, createTemplateDb, sealTemplateDb } from './support/db-reset.ts';
import { BASE_PORT, MAILPIT_URL, originFor } from './support/server-pool.ts';

export default async function globalSetup(): Promise<void> {
  await assertStackUp(MAILPIT_URL);
  await createTemplateDb();
  mkdirSync(AUTH_DIR, { recursive: true });
  const origin = originFor(BASE_PORT);
  for (const user of E2E_USERS) {
    // One context per user, so each storageState holds exactly that user's session cookie.
    const context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { origin } });
    try {
      const response = await context.post('/api/auth/dev/sign-in', {
        data: { email: user.email, name: user.name },
      });
      if (!response.ok()) {
        throw new Error(
          `e2e: dev sign-in failed for ${user.email}: ${String(response.status())} ${await response.text()}`,
        );
      }
      await context.storageState({ path: storageStatePath(user.workspace, user.role) });
    } finally {
      await context.dispose();
    }
  }
  await sealTemplateDb();
}
