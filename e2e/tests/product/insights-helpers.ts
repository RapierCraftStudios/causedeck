// Shared open and locators for the insights specs (#966). The dashboard lives at
// `/w/chennai-solo/insights` and is behind the `insights.enabled` flag.
import type { Locator, Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { enableInsights, seedInsights } from '../../fixtures/insights-data.ts';
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import type { E2eRole } from '../../fixtures/workspace.ts';
import { contentReady } from '../shell/helpers.ts';

export const INSIGHTS_PATH = 'insights';

/** Flag on, hearings seeded, signed in as `role`, the page hydrated. */
export async function openInsights(
  page: Page,
  asUser: AsUser,
  database: string,
  {
    role = 'owner',
    query = '',
    seed = true,
  }: { role?: E2eRole; query?: string; seed?: boolean } = {},
): Promise<void> {
  await enableInsights(database);
  if (seed) await seedInsights(database);
  await asUser(role, { workspace: MATTERS_WORKSPACE, path: `${INSIGHTS_PATH}${query}` });
  await contentReady(page);
}

/** The route's content; scoped to `main` because a streamed hidden copy can sit outside it. */
export const route = (page: Page): Locator =>
  page.locator('main [data-route="insights"]').filter({ visible: true });

/** The Prepared & Kept figure. */
export const heroRate = (page: Page): Locator =>
  route(page).locator('[data-slot="insights-hero-rate"]');

/** A supporting tile by its title ("Obligations kept", "Preparedness", "Load"). */
export const tile = (page: Page, name: string): Locator =>
  route(page).locator(`[data-slot="insights-tile"][data-tile="${name}"]`);
