// Courts area journeys (#425; design #42, pages #399, #400, #402). The template carries
// `chennai-solo`'s parse history for catalogue forums (fixtures/courts-data.ts): the Madras HC
// Original Side's newest list could not read Hall 12 (the degraded banner), its Appellate Side's
// lists named halls 2, 5 and 12A, the Chennai City Civil Court (A0) has no lists, and the Madurai
// Bench is planned. Covers the index, detail tabs, add-forum by role, the planned section, the five
// states, the keyboard model, that no court page is framed and that no rating copy shows.
import { expect, test } from '../../fixtures/index.ts';
import {
  A0_FORUM,
  COURTS_ADAPTER_ID,
  COURTS_ADAPTER_VERSION,
  COURTS_WORKSPACE,
  COURTS_WORKSPACE_ID,
  DEGRADED_FORUM,
  HALLS_FORUM,
  PLANNED_FORUM,
  UNREADABLE_HALL,
} from '../../fixtures/courts-data.ts';

import {
  FIXTURE_WORKSPACE_ID,
  courtsPath,
  emptyCatalogue,
  expectNoCourtFrames,
  expectNoRatingCopy,
  openCourts,
  type ForumTab,
} from './helpers.ts';

const BANNER = `Couldn't read today's list for Hall ${UNREADABLE_HALL}`;
const url = (path: string) => `/w/${COURTS_WORKSPACE}/${path}`;

test('the fixture workspace id matches the e2e seed', () => {
  expect(COURTS_WORKSPACE_ID).toBe(FIXTURE_WORKSPACE_ID);
});

test.describe('courts index', () => {
  test('groups forums by city with level, side, status and the degraded banner', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser);
    const main = page.locator('main');
    await expect(main.locator('[data-city="Chennai"]')).toHaveText('Chennai');
    await expect(main.locator('[data-city="Bengaluru"]')).toHaveText('Bengaluru');

    const degraded = main.locator(`[data-forum-card="${DEGRADED_FORUM}"]`);
    await expect(degraded.locator('[data-adapter-level="A1"]')).toBeVisible();
    await expect(degraded.locator('[data-forum-side="original"]')).toHaveText('Original side');
    await expect(degraded.locator('[data-forum-status="degraded"]')).toHaveText('Partly read');
    const banner = degraded.locator('[data-forum-banner="degraded"]');
    await expect(banner).toContainText(BANNER);
    const official = banner.locator(`[data-forum-official="${DEGRADED_FORUM}"]`);
    await expect(official).toContainText('Open the official list');
    await expect(official).toHaveAttribute('target', '_blank');
    await expect(official).toHaveAttribute('rel', /noopener/);
    await expect(official).toHaveAttribute('rel', /noreferrer/);
    await expect(banner.locator(`[data-forum-share="${DEGRADED_FORUM}"]`)).toHaveAttribute(
      'href',
      url('inbox'),
    );

    const halls = main.locator(`[data-forum-card="${HALLS_FORUM}"]`);
    await expect(halls.locator('[data-forum-status="ok"]')).toHaveText('Lists read');
    await expect(halls.locator('[data-forum-banner]')).toHaveCount(0);

    const a0 = main.locator(`[data-forum-card="${A0_FORUM}"]`);
    await expect(a0.locator('[data-adapter-level="A0"]')).toBeVisible();
    await expect(a0.locator('[data-forum-status="none"]')).toHaveText('No lists yet');
  });

  test('lists planned forums apart, with their reason and no links', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    const planned = page.locator('[data-courts-planned]');
    await expect(planned.getByRole('heading', { level: 2 })).toHaveText('Planned');
    const forum = planned.locator(`[data-planned-forum="${PLANNED_FORUM}"]`);
    await expect(forum).toContainText('Madurai Bench');
    await expect(forum).toContainText('Separate adapter config planned in v2');
    await expect(planned.locator('a')).toHaveCount(0);
    await expect(page.locator(`[data-forum-card="${PLANNED_FORUM}"]`)).toHaveCount(0);
  });

  test('the bengaluru-chamber workspace sees none of chennai-solo’s lists', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { workspace: 'bengaluru-chamber' });
    const card = page.locator(`[data-forum-card="${DEGRADED_FORUM}"]`);
    await expect(card.locator('[data-forum-status="none"]')).toBeVisible();
    await expect(page.locator('[data-forum-banner]')).toHaveCount(0);
  });
});

test.describe('forum detail', () => {
  test('a card opens the Halls tab; the tabs mark the current one', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.locator(`[data-forum-link="${HALLS_FORUM}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/courts/${HALLS_FORUM}/halls$`));
    const tabs = page.locator('[data-slot="forum-tabs"]');
    await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute('data-forum-tab', 'halls');
    // The Rosters tab (#435) opens the workspace rosters page with this forum selected.
    await expect(tabs.locator('[data-forum-tab="rosters"]')).toHaveAttribute(
      'href',
      new RegExp(`/courts/rosters\\?forum=${HALLS_FORUM.replaceAll('.', '\\.')}$`),
    );
    await expect(page.locator('[data-hall]')).toHaveText([/^2/, /^5/, /^12A/]);
    await expect(page.locator('[data-hall-unreadable]')).toHaveCount(0);

    await tabs.locator('[data-forum-tab="adapter"]').click();
    await expect(page).toHaveURL(new RegExp(`/courts/${HALLS_FORUM}/adapter$`));
    await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute(
      'data-forum-tab',
      'adapter',
    );
    await tabs.locator('[data-forum-tab="links"]').click();
    await expect(page).toHaveURL(new RegExp(`/courts/${HALLS_FORUM}/links$`));
    await page.locator('[data-forum-back]').click();
    await expect(page).toHaveURL(new RegExp(`${url('courts')}$`));
  });

  test('the degraded forum: banner in the header, hall 12 unreadable', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: courtsPath(DEGRADED_FORUM) });
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText(
      'Madras High Court',
    );
    const header = page.locator(`[data-slot="forum-header"][data-forum="${DEGRADED_FORUM}"]`);
    await expect(header.locator('[data-adapter-level="A1"]')).toBeVisible();
    await expect(header.locator('[data-forum-banner="degraded"]')).toContainText(BANNER);
    await expect(page.locator('[data-hall]')).toHaveCount(2);
    await expect(
      page.locator(`[data-hall="${UNREADABLE_HALL}"] [data-hall-unreadable]`),
    ).toHaveText('Unreadable');
    await expect(page.locator('[data-hall="1"] [data-hall-unreadable]')).toHaveCount(0);
  });

  test('the A1 adapter tab: version, level help, verification, health and last parse', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { path: courtsPath(DEGRADED_FORUM, 'adapter') });
    const card = page.locator(`[data-adapter-status="${COURTS_ADAPTER_ID}"]`);
    await expect(card.locator('[data-adapter-field="version"]')).toContainText(
      COURTS_ADAPTER_VERSION,
    );
    await expect(
      card.locator('[data-adapter-field="level"] [data-adapter-level="A1"]'),
    ).toBeVisible();
    await expect(card.locator('[data-adapter-field="verified"]')).toContainText(
      'Not yet verified with real lists',
    );
    // Two of the three runs were read in full: degraded, not failed.
    await expect(card.locator('[data-adapter-health="degraded"]')).toHaveText(
      'Some lists not read',
    );
    await expect(card.locator('[data-adapter-unreadable]')).toHaveText(
      `Unreadable halls: ${UNREADABLE_HALL}`,
    );
    await card.locator('[data-adapter-levels-trigger]').click();
    await expect(page.locator('[data-adapter-level-help="A1"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-adapter-levels]')).toHaveCount(0);
    // The template has no access-mode registry rows (tests/admin/adapters.spec.ts relies on it).
    await expect(page.locator('[data-access-modes-empty]')).toBeVisible();
  });

  test('the links tab: new-window anchors and the captcha notice', async ({ page, asUser }) => {
    await openCourts(page, asUser, { path: courtsPath(DEGRADED_FORUM, 'links') });
    const causeList = page.locator('[data-deep-link="cause_list"]');
    const anchor = causeList.getByRole('link');
    await expect(anchor).toHaveAttribute('target', '_blank');
    await expect(anchor).toHaveAttribute('rel', /noopener/);
    await expect(anchor).toHaveAttribute('rel', /noreferrer/);
    await expect(anchor).toContainText("Opens the court's website in a new window");
    await expect(causeList.locator('[data-captcha-notice]')).toBeVisible();
  });

  test('the A0 forum: the generic adapter version, and an empty Halls tab that explains', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser, { path: courtsPath(A0_FORUM) });
    const header = page.locator(`[data-slot="forum-header"][data-forum="${A0_FORUM}"]`);
    await expect(header.locator('[data-adapter-level="A0"]')).toBeVisible();
    await expect(header.locator('[data-forum-banner]')).toHaveCount(0);
    const empty = page.locator('[data-halls-empty]');
    await expect(empty).toContainText('No halls seen yet');
    await page.locator('[data-forum-tab="adapter"]').click();
    // The A0 generic adapters (#56, migration 0063) are active at 1.0.0 for the district forums: an A0
    // forum has a version but still no parse history or halls.
    await expect(page.locator('[data-adapter-field="version"]')).toContainText('1.0.0');
  });

  test('an unknown forum code is not found', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.goto(url(courtsPath('in.example.not-a-forum')));
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText(
      'Page not found',
    );
  });
});

test.describe('add forum', () => {
  for (const [role, shown] of [
    ['owner', true],
    ['advocate', true],
    ['clerk', false],
    ['viewer', false],
  ] as const) {
    test(`${role} ${shown ? 'sees' : 'does not see'} Add forum`, async ({ page, asUser }) => {
      await openCourts(page, asUser, { role });
      await expect(page.locator('[role="grid"]')).toBeVisible();
      await expect(page.locator('[data-slot="add-forum"]')).toHaveCount(shown ? 1 : 0);
    });
  }

  test('an owner adds a workspace forum and it joins the index', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.locator('[data-slot="add-forum"]').click();
    const dialog = page.getByRole('dialog', { name: 'Add a forum' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Forum name').fill('Tambaram Fictional Court');
    await dialog.getByLabel('City').fill('Tambaram');
    await dialog.getByLabel('Forum code').fill('ws.tambaram.fictional-court');
    await dialog.getByRole('button', { name: 'Add forum' }).click();
    await expect(dialog).toBeHidden();
    const card = page.locator('[data-forum-card="ws.tambaram.fictional-court"]');
    await expect(card).toContainText('Tambaram Fictional Court');
    await expect(card).toContainText('Your forum');
    await expect(card.locator('[data-adapter-level="A0"]')).toBeVisible();
    await expect(page.locator('[data-city="Tambaram"]')).toBeVisible();
  });

  test('a catalogue code is refused as taken', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.locator('[data-slot="add-forum"]').click();
    const dialog = page.getByRole('dialog', { name: 'Add a forum' });
    await dialog.getByLabel('Forum name').fill('Duplicate');
    await dialog.getByLabel('City').fill('Chennai');
    await dialog.getByLabel('Forum code').fill(A0_FORUM);
    await dialog.getByRole('button', { name: 'Add forum' }).click();
    await expect(dialog).toContainText('This code belongs to an existing forum. Choose another.');
  });
});

test.describe('courts states', () => {
  test('loading: the forum card skeleton', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.goto(url('courts?__state=loading'));
    await expect(page.locator('main [data-slot="courts-skeleton"]')).toBeVisible();
    await expect(page.locator('[role="grid"]')).toHaveCount(0);
  });

  test('error: Could not load courts, with Try again', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.goto(url('courts?__state=error'));
    const main = page.locator('main');
    await expect(main.getByText('Could not load courts.')).toBeVisible({ timeout: 15_000 });
    await expect(main.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('empty: no forums at all', async ({ page, asUser, db }) => {
    await emptyCatalogue(db.name);
    await openCourts(page, asUser);
    const empty = page.locator('main [data-pattern-state="empty"]');
    await expect(empty).toContainText('Choose your courts to get started.');
    await expect(page.locator('[role="grid"]')).toHaveCount(0);
    await expect(page.locator('[data-courts-planned]')).toHaveCount(0);
  });

  test('offline: saved court information, gone once back online', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    const banner = page.locator('main [data-courts-offline]');
    await expect(banner).toHaveCount(0);
    await page.context().setOffline(true);
    await expect(banner).toContainText('Showing saved court information from');
    await expect(page.locator('[role="grid"]')).toBeVisible();
    await page.context().setOffline(false);
    await expect(banner).toHaveCount(0);
  });

  test('permission-denied: No access', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    await page.goto(url('courts?__state=denied'));
    const main = page.locator('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('No access');
    await expect(main).toContainText('You do not have access to this area.');
    await expect(page.locator('[role="grid"]')).toHaveCount(0);
  });
});

test.describe('courts keyboard', () => {
  test('/ focuses search; typing filters; a miss says so', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    const search = page.getByRole('searchbox', { name: 'Search forums' });
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await page.keyboard.type('Madras');
    await expect(page.locator('[data-forum-card]')).toHaveCount(2);
    await expect(page.locator(`[data-planned-forum="${PLANNED_FORUM}"]`)).toBeVisible();
    await search.fill('zz-no-such-forum');
    await expect(page.locator('[data-forum-no-match]')).toContainText('zz-no-such-forum');
    await expect(page.locator('[role="grid"]')).toHaveCount(0);
  });

  test('the grid is one tab stop; arrows, Home and End move; Enter opens', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser);
    const links = page.locator('[role="grid"] [data-forum-link]');
    const count = await links.count();
    expect(count).toBeGreaterThan(3);
    await expect(page.locator('[role="grid"] [data-forum-link][tabindex="0"]')).toHaveCount(1);

    await page.getByRole('searchbox', { name: 'Search forums' }).focus();
    await page.keyboard.press('Tab');
    await expect(links.first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(links.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(links.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(links.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(links.first()).not.toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(links.first()).toBeFocused();
    // Roving tabindex: the focused card is the only tab stop.
    await page.keyboard.press('ArrowRight');
    await expect(links.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(page.locator('[role="grid"] [data-forum-link][tabindex="0"]')).toHaveCount(1);

    const code = await links.nth(1).getAttribute('data-forum-link');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/courts/${code ?? ''}/halls$`));
  });

  test('Esc closes the add-forum dialog and returns focus to its trigger', async ({
    page,
    asUser,
  }) => {
    await openCourts(page, asUser);
    const trigger = page.locator('[data-slot="add-forum"]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add a forum' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('courts boundaries', () => {
  const pages: { name: string; path: string }[] = [
    { name: 'index', path: courtsPath() },
    ...[DEGRADED_FORUM, A0_FORUM].flatMap((code) =>
      (['halls', 'adapter', 'links'] satisfies ForumTab[]).map((tab) => ({
        name: `${code} ${tab}`,
        path: courtsPath(code, tab),
      })),
    ),
  ];

  test('no court page is framed, embedded or objected anywhere', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    for (const { path } of pages) {
      await page.goto(url(path));
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoCourtFrames(page);
    }
  });

  test('no ratings, rankings, judges or popularity anywhere', async ({ page, asUser }) => {
    await openCourts(page, asUser);
    for (const { path } of pages) {
      await page.goto(url(path));
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoRatingCopy(page);
    }
  });
});
