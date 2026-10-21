// Shared set-up for the courts specs (#425). Fixture data (forums, parse runs) lives in
// fixtures/courts-data.ts, which support/db-reset.ts seeds into the template.
import { FORUM_CATALOGUE } from '@causedeck/db/seed/forum-catalogue';
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { COURTS_WORKSPACE } from '../../fixtures/courts-data.ts';
import { E2E_WORKSPACES, expect, type E2eRole } from '../../fixtures/index.ts';
import { withSql } from '../lifecycle/helpers.ts';
import { shellReady } from '../shell/helpers.ts';

export type ForumTab = 'halls' | 'adapter' | 'links';

/** `/w/chennai-solo/courts[/<code>/<tab>]`, relative to the workspace. */
export function courtsPath(code?: string, tab: ForumTab = 'halls'): string {
  return code === undefined ? 'courts' : `courts/${code}/${tab}`;
}

/** Sign in as `role` of the fixture workspace and open a courts page, hydrated. */
export async function openCourts(
  page: Page,
  asUser: AsUser,
  { role = 'owner', path = courtsPath() }: { role?: E2eRole; path?: string } = {},
): Promise<void> {
  await asUser(role, { workspace: COURTS_WORKSPACE, path });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
}

/** Every hostname of a court's official pages (forum catalogue `config.hosts`). */
export const COURT_HOSTS: ReadonlySet<string> = new Set(
  FORUM_CATALOGUE.flatMap((forum) => forum.config.hosts),
);

/** Copy the courts area must never show (#42): ratings, rankings, judges or popularity. */
export const FORBIDDEN_COPY: readonly RegExp[] = [
  /\bratings?\b/i,
  /\brank(s|ed|ing|ings)?\b/i,
  /\bjudges?\b/i,
  /\bpopular(ity)?\b/i,
  /\bstars?\b/i,
];

/** No `<iframe>`, `<embed>` or `<object>` on the page points at a court host. */
export async function expectNoCourtFrames(page: Page): Promise<void> {
  expect(COURT_HOSTS.size).toBeGreaterThan(0);
  const sources = await page.evaluate(() =>
    [...document.querySelectorAll('iframe, embed, object')].map(
      (node) => node.getAttribute('src') ?? node.getAttribute('data') ?? '',
    ),
  );
  const framed = sources.filter((source) => {
    try {
      return COURT_HOSTS.has(new URL(source, 'http://local.invalid').hostname);
    } catch {
      return false;
    }
  });
  expect(framed, `court pages framed on ${page.url()}`).toEqual([]);
}

/** The page's main content shows none of FORBIDDEN_COPY. */
export async function expectNoRatingCopy(page: Page): Promise<void> {
  const text = await page.locator('main').innerText();
  for (const pattern of FORBIDDEN_COPY) {
    expect(text, `${String(pattern)} on ${page.url()}`).not.toMatch(pattern);
  }
}

/** Drop every catalogue forum from the worker database: the courts index has nothing to list. */
export function emptyCatalogue(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`delete from forum where workspace_id is null`;
  });
}

/** fixtures/courts-data.ts hardcodes the workspace id (db-reset.ts cannot load the db package). */
export const FIXTURE_WORKSPACE_ID = E2E_WORKSPACES[COURTS_WORKSPACE].id;
