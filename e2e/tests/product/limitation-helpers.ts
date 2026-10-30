// Shared open and locators for the limitation specs (#942). The tracker lives at
// `/w/chennai-solo/limitation` and is behind the legal-gated `limitation.enabled` flag.
import type { Locator, Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import {
  enableLimitation,
  seedLimitation,
  type SeedLimitationOptions,
} from '../../fixtures/limitation-data.ts';
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { contentReady } from '../shell/helpers.ts';

export const LIMITATION_PATH = 'limitation';

export type LimitationRole = 'owner' | 'advocate' | 'clerk' | 'viewer';

/** Flag on, synthetic rules seeded, signed in as `role`, the page hydrated. */
export async function openLimitation(
  page: Page,
  asUser: AsUser,
  database: string,
  { role = 'owner', ...seed }: SeedLimitationOptions & { role?: LimitationRole } = {},
): Promise<void> {
  await enableLimitation(database);
  await seedLimitation(database, seed);
  await asUser(role, { workspace: MATTERS_WORKSPACE, path: LIMITATION_PATH });
  await contentReady(page);
}

/** The route's content; scoped to `main` because a streamed hidden copy can sit outside it. */
export const route = (page: Page): Locator =>
  page.locator('main [data-route="limitation"]').filter({ visible: true });

/** The computation cards (visible copies only). */
export const cards = (page: Page): Locator =>
  page.locator('[data-slot="limitation-card"]').filter({ visible: true });
