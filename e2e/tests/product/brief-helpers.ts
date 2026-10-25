// Shared open helper for the Brief Sheet specs (#61): the seeded appeal matter's canonical listing.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, type E2eRole } from '../../fixtures/index.ts';
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';

export const BRIEF_LISTING_ID = MATTERS.appeal.listings[0]?.id ?? '';

export async function openBrief(
  page: Page,
  asUser: AsUser,
  {
    role = 'owner',
    size = { width: 1280, height: 900 },
  }: { role?: E2eRole; size?: { width: number; height: number } } = {},
): Promise<void> {
  await page.setViewportSize(size);
  await asUser(role, { workspace: MATTERS_WORKSPACE, path: `briefs/${BRIEF_LISTING_ID}` });
  await expect(page.locator('[data-brief-sheet]')).toBeVisible();
}
