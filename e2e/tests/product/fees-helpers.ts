// Shared open and locators for the fees specs (#872). The page lives at `/w/chennai-solo/invoices`
// and is behind the legal-gated `invoices.enabled` flag.
import type { Locator, Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { enableFees, seedFees, type SeedFeesOptions } from '../../fixtures/fees-data.ts';
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { contentReady } from '../shell/helpers.ts';

export const FEES_PATH = 'invoices';

export type FeesRole = 'owner' | 'advocate' | 'clerk' | 'viewer';

/** Flag on, fictional fee records seeded, signed in as `role` at `path`, the page hydrated. */
export async function openFees(
  page: Page,
  asUser: AsUser,
  database: string,
  {
    role = 'owner',
    path = FEES_PATH,
    ...seed
  }: SeedFeesOptions & { role?: FeesRole; path?: string } = {},
): Promise<void> {
  await enableFees(database);
  await seedFees(database, seed);
  await asUser(role, { workspace: MATTERS_WORKSPACE, path });
  await contentReady(page);
}

/** The list route's content; scoped to `main` because a streamed hidden copy can sit outside it. */
export const route = (page: Page, name = 'invoices'): Locator =>
  page.locator(`main [data-route="${name}"]`).filter({ visible: true });

/** The invoice rows of the list (visible copies only). */
export const invoiceRows = (page: Page): Locator =>
  page.locator('[data-slot="invoice-row"]').filter({ visible: true });

/** The fee agreement cards of the list (visible copies only). */
export const agreementCards = (page: Page): Locator =>
  page.locator('[data-slot="fee-agreement-card"]').filter({ visible: true });

/** An empty state's title: the ui EmptyState renders it as a paragraph, not a heading. */
export const emptyTitle = (page: Page, text: string): Locator =>
  route(page).locator('[data-slot="empty-state-title"]', { hasText: text });
