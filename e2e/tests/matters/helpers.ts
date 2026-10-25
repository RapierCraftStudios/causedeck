// Shared set-up for the matters specs (#394). Fixture data (journey matters, the 500-matter bulk)
// lives in fixtures/matters-data.ts, which support/db-reset.ts seeds into the template.
import type { Locator, Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { MATTERS, MATTERS_WORKSPACE, type MatterFixture } from '../../fixtures/matters-data.ts';
import { expect, type E2eRole } from '../../fixtures/index.ts';
import { withSql } from '../lifecycle/helpers.ts';
import { shellReady } from '../shell/helpers.ts';

export type MatterTab = 'overview' | 'proceedings' | 'people' | 'documents';

/** `matters[?query]`, relative to the workspace. */
export function mattersPath(query = ''): string {
  return query === '' ? 'matters' : `matters?${query}`;
}

/** `matters/<id>[/<tab>]`, relative to the workspace. */
export function matterPath(matter: MatterFixture, tab: MatterTab = 'overview'): string {
  return tab === 'overview' ? `matters/${matter.id}` : `matters/${matter.id}/${tab}`;
}

/** Sign in as `role` of the fixture workspace and open a matters page, hydrated. */
export async function openMatters(
  page: Page,
  asUser: AsUser,
  { role = 'owner', path = mattersPath() }: { role?: E2eRole; path?: string } = {},
): Promise<void> {
  await asUser(role, { workspace: MATTERS_WORKSPACE, path });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
}

/** The list's layout in use at this viewport: the table from 768 px, cards below. */
export function listLayout(page: Page): Locator {
  const width = page.viewportSize()?.width ?? 1280;
  return page.locator(`[data-matters-layout="${width >= 768 ? 'table' : 'cards'}"]`);
}

/** The visible row (or card) of a matter. */
export function matterRow(page: Page, matter: MatterFixture): Locator {
  return listLayout(page).locator(`[data-matter-row="${matter.id}"]`);
}

/** The journey matters in the order the default sort (next date, nulls last) lists them. */
export const JOURNEY_ORDER = [
  MATTERS.appeal,
  MATTERS.conflict,
  MATTERS.proposed,
  MATTERS.tamil,
  MATTERS.kannada,
] as const;

/** Mask for screenshots: the relative "in N days" text follows the real server clock. */
export function volatile(page: Page): Locator[] {
  return [page.locator('[data-matter-next-date], [data-row-next-date], [data-next-date]')];
}

/**
 * Drop every matter of the fixture workspace with what hangs off it (the bench-change alerts of the
 * roster fixtures, role edges, listings, proceedings, matter documents): the list is empty.
 */
export function emptyMatters(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    const ws = COURTS_WORKSPACE_ID;
    await sql`delete from bench_change_alert where workspace_id = ${ws}`;
    await sql`delete from role_edge where workspace_id = ${ws}`;
    await sql`delete from listing where workspace_id = ${ws}`;
    await sql`delete from proceeding_link where workspace_id = ${ws}`;
    await sql`delete from proceeding where workspace_id = ${ws}`;
    await sql`delete from document where workspace_id = ${ws} and matter_id is not null`;
    await sql`delete from matter where workspace_id = ${ws}`;
  });
}
