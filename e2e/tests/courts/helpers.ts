// Shared set-up for the courts specs (#425). Fixture data (forums, parse runs) lives in
// fixtures/courts-data.ts, which support/db-reset.ts seeds into the template.
import { FORUM_CATALOGUE } from '@causedeck/db/seed/forum-catalogue';
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { COURTS_WORKSPACE, COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { E2E_WORKSPACES, expect, type E2eRole } from '../../fixtures/index.ts';
import { rosterImportPdf } from '../../fixtures/roster-pdf.ts';
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

/**
 * Drop every catalogue forum from the worker database: the courts index has nothing to list. Rows
 * that point at a forum (proceedings from the matter graph, rosters, ...) go first, since their
 * foreign keys restrict the delete; the worker database is reset from the template per test.
 */
export function emptyCatalogue(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql.unsafe(`
      do $$
      declare r record;
      begin
        for r in
          select distinct conrelid::regclass as t from pg_constraint
           where contype = 'f' and confrelid = 'forum'::regclass and conrelid <> 'forum'::regclass
        loop
          execute format('truncate %s cascade', r.t);
        end loop;
      end $$`);
    await sql`delete from forum where workspace_id is null`;
  });
}

/** fixtures/courts-data.ts hardcodes the workspace id (db-reset.ts cannot load the db package). */
export const FIXTURE_WORKSPACE_ID = E2E_WORKSPACES[COURTS_WORKSPACE].id;

// ---- Bench rosters (#437) ----

/** `courts/rosters[?forum=<code>]`, relative to the workspace. */
export function rostersPath(forum?: string): string {
  return forum === undefined ? 'courts/rosters' : `courts/rosters?forum=${forum}`;
}

/** `courts/rosters/import[?forum=<code>]`, relative to the workspace. */
export function rosterImportPath(forum?: string): string {
  return forum === undefined ? 'courts/rosters/import' : `courts/rosters/import?forum=${forum}`;
}

/** Drop every roster (and its alerts) of the fixture workspace: the rosters page is empty. */
export function emptyRosters(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`delete from bench_change_alert where workspace_id = ${COURTS_WORKSPACE_ID}`;
    await sql`delete from bench_roster where workspace_id = ${COURTS_WORKSPACE_ID}`;
  });
}

/**
 * FORBIDDEN_COPY for the roster pages: the court-published composition is shown there (the import
 * grid's `Judges` column, benches labelled by their judges), so `judges` itself is allowed; ratings,
 * rankings, popularity and stars are not (PX-9, ME-6).
 */
export const ROSTER_FORBIDDEN_COPY: readonly RegExp[] = FORBIDDEN_COPY.filter(
  (pattern) => !pattern.test('judges'),
);

/** The page's main content shows none of ROSTER_FORBIDDEN_COPY. */
export async function expectNoRosterRatingCopy(page: Page): Promise<void> {
  expect(ROSTER_FORBIDDEN_COPY.length).toBe(FORBIDDEN_COPY.length - 1);
  const text = await page.locator('main').innerText();
  for (const pattern of ROSTER_FORBIDDEN_COPY) {
    expect(text, `${String(pattern)} on ${page.url()}`).not.toMatch(pattern);
  }
}

/**
 * On the import page, upload fixtures/roster-pdf.ts through `/api/uploads` (MinIO) and wait for
 * the review grid the parsed rows fill.
 */
export async function uploadRosterPdf(page: Page): Promise<void> {
  await page.locator('[data-roster-import="upload"] input[type="file"]').setInputFiles({
    name: 'sitting-arrangements.pdf',
    mimeType: 'application/pdf',
    buffer: rosterImportPdf(),
  });
  const grid = page.locator('[data-roster-import-grid]');
  const failure = page.locator(
    '[data-roster-import-error], [data-roster-import="unreadable"], [data-roster-import="upload"] [role="alert"]',
  );
  // Fail fast with the page's own message when the upload or the preview fails, instead of
  // waiting out the grid's timeout blind.
  await expect(grid.or(failure).first()).toBeVisible({ timeout: 20_000 });
  if (!(await grid.isVisible())) {
    const message = await failure.first().innerText();
    throw new Error(`roster import did not reach the review grid: ${message}`);
  }
}
