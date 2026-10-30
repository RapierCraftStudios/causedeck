// Court-day board journeys (#59) on `/w/chennai-solo/today` and `/tomorrow`, against the seeded
// chamber day in fixtures/court-day-data.ts (listings relative to the real IST date). Every test
// sets the viewport it needs, so it runs the same in each Playwright project. `@a11y` runs axe
// after the test with zero serious or critical violations allowed (R19).
import type { Locator, Page } from '@playwright/test';
import postgres from 'postgres';

import { COURT_DAY, seedCourtDay, type CourtDayOptions } from '../../fixtures/court-day-data.ts';
import { expect as baseExpect, test } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { SHELL_WORKSPACE, contentReady } from '../shell/helpers.ts';

// Client navigations render a dynamic route and a server action writes to Postgres: allow for a
// busy runner.
const expect = baseExpect.configure({ timeout: 15_000 });

const PHONE = { width: 360, height: 780 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 800 };

/**
 * Turn `bench_facts` on for the shell workspace. It is legal-gated (#118): it is on only when the
 * global row and the workspace row are both on and carry `legal_ack_by` and a note. A workspace row
 * alone never enables it.
 */
async function enableBenchFacts(database: string): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`
      insert into feature_flag (key, enabled, updated_by, legal_ack_by, legal_ack_note)
      select 'bench_facts', true, m.user_id, m.user_id,
             'e2e fixture: counsel sign-off recorded (fictional)'
        from organization o
        join member m on m.workspace_id = o.id and m.role = 'owner'
       where o.slug = ${SHELL_WORKSPACE}
       limit 1
      on conflict (key) do update set enabled = true, legal_ack_by = excluded.legal_ack_by,
        legal_ack_note = excluded.legal_ack_note`;
    await sql`
      insert into workspace_feature_flag
        (workspace_id, key, enabled, updated_by, legal_ack_by, legal_ack_note)
      select o.id, 'bench_facts', true, m.user_id, m.user_id,
             'e2e fixture: counsel sign-off recorded (fictional)'
        from organization o
        join member m on m.workspace_id = o.id and m.role = 'owner'
       where o.slug = ${SHELL_WORKSPACE}
       limit 1
      on conflict do nothing`;
  } finally {
    await sql.end();
  }
}

async function openBoard(
  page: Page,
  asUser: (role: 'owner' | 'advocate' | 'clerk' | 'viewer', o: { path: string }) => Promise<Page>,
  db: Parameters<typeof seedCourtDay>[0],
  {
    role = 'owner',
    path = '/today',
    size = DESKTOP,
    seed,
    benchFacts = false,
  }: {
    role?: 'owner' | 'advocate' | 'clerk' | 'viewer';
    path?: string;
    size?: { width: number; height: number };
    seed?: CourtDayOptions;
    /** The `bench_facts` flag is on (off by default, as in the seed). */
    benchFacts?: boolean;
  } = {},
): Promise<{ today: string; tomorrow: string }> {
  const days = await seedCourtDay(db, seed);
  if (benchFacts) await enableBenchFacts(db.name);
  await page.setViewportSize(size);
  await asUser(role, { path });
  await contentReady(page);
  return days;
}

const hall = (page: Page, no: string): Locator =>
  page.locator(`section[data-hall-column][aria-label="Hall ${no}"]`);
const item = (scope: Page | Locator, n: string): Locator =>
  scope.locator(`[data-court-item][aria-label^="Item ${n},"]`);
const numbers = async (column: Locator) =>
  (
    await column
      .locator('[data-court-item]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
  ).map((label) => /^Item ([^,]+),/.exec(label)?.[1]);

test.describe('court-day board', () => {
  // Each test seeds a day, boots a signed-in page and renders a dynamic route.
  test.describe.configure({ timeout: 90_000 });

  // R1
  test(
    'today groups the chamber day complex, hall, item with items in numeric order',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openBoard(page, asUser, db);
      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
      await expect(page.locator('[data-court-day-board]')).toBeVisible();
      // Hall 3 holds six items; 9 comes before 10 and 12, and the unnumbered sort is not involved.
      expect(await numbers(hall(page, '3'))).toEqual(['1', '9', '10', '12', '14', '20']);
      expect(await numbers(hall(page, '7'))).toEqual(['5', '22']);
      expect(await numbers(hall(page, '1'))).toEqual(['9']);
      // The hall header names its complex; the case number keeps its (MD) suffix.
      await expect(hall(page, '3').locator('[data-slot="hall-header"]')).toContainText(
        'Madras High Court',
      );
      await expect(item(hall(page, '3'), '14')).toContainText(COURT_DAY.moved);
      await expect(item(hall(page, '3'), '14')).toContainText('(MD)');
      // Stage badges carry the stage as text.
      await expect(item(hall(page, '3'), '14')).toContainText('Part-heard');
      await expect(item(hall(page, '3'), '1')).toContainText('Numbered');
    },
  );

  test('tomorrow shows the next day and the day switch navigates', async ({ page, asUser, db }) => {
    await openBoard(page, asUser, db);
    await page
      .getByRole('navigation', { name: 'Court day' })
      .getByRole('link', { name: 'Tomorrow' })
      .click();
    await expect(page).toHaveURL(/\/tomorrow$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tomorrow' })).toBeVisible();
    // The plan below the board names the matter too: the board's item is the link.
    await expect(
      page
        .locator('[data-court-item]')
        .getByRole('link', { name: 'Tomorrow v. State (fictional)' }),
    ).toBeVisible();
    await expect(page.getByText(COURT_DAY.sharedTitle)).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Court day' })
      .getByRole('link', { name: 'Today' })
      .click();
    await expect(page).toHaveURL(/\/today$/);
  });

  // R2
  test('at 360 px one hall shows with a sticky rail and ?hall= survives reload and back', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db, { size: PHONE });
    const rail = page.locator('[data-hall-rail]');
    await expect(rail).toBeVisible();
    expect(await rail.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    await expect(page.locator('section[data-hall-column]:visible')).toHaveCount(1);
    const first = page.locator('section[data-hall-column]:visible');
    const firstLabel = await first.getAttribute('aria-label');

    await rail.getByRole('link', { name: /^Hall 7/ }).click();
    await expect(page).toHaveURL(/\?hall=/);
    await expect(hall(page, '7')).toBeVisible();
    await expect(page.locator('section[data-hall-column]:visible')).toHaveCount(1);
    await expect(rail.getByRole('link', { name: /^Hall 7/ })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await page.reload();
    await contentReady(page);
    await expect(hall(page, '7')).toBeVisible();
    await expect(rail.getByRole('link', { name: /^Hall 7/ })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await page.goBack();
    await expect(page).not.toHaveURL(/\?hall=/);
    await expect(page.locator('section[data-hall-column]:visible')).toHaveAttribute(
      'aria-label',
      firstLabel ?? '',
    );
    // A hall chip shows its item count and is at least 44 px tall.
    await expect(rail.getByRole('link', { name: /^Hall 7/ })).toContainText('2');
  });

  // R3
  test('at 768 px two columns share a row and the day rail is a bottom drawer', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db, { size: TABLET });
    const columns = page.locator('section[data-hall-column]:visible');
    expect(await columns.count()).toBeGreaterThanOrEqual(3);
    const a = await columns.nth(0).boundingBox();
    const b = await columns.nth(1).boundingBox();
    const c = await columns.nth(2).boundingBox();
    expect(a && b && c).toBeTruthy();
    expect(Math.abs((a?.y ?? 0) - (b?.y ?? 1))).toBeLessThan(2);
    expect((b?.x ?? 0) - (a?.x ?? 0)).toBeGreaterThan(100);
    expect(c?.y ?? 0).toBeGreaterThan((a?.y ?? 0) + 50);
    const drawer = page.locator('[data-day-drawer]');
    await expect(drawer.locator('summary')).toBeVisible();
    await expect(drawer.locator('summary')).toContainText(/Carry \d+, needs you \d+/);
    await expect(page.locator('[data-day-rail]')).toBeHidden();
    await drawer.locator('summary').click();
    await expect(drawer.getByRole('heading', { name: 'Carry list' })).toBeVisible();
    await expect(page.locator('[data-hall-rail]')).toBeHidden();
  });

  test('at 1280 px columns snap, headers are sticky and the right rail has carry and needs you', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db, { size: DESKTOP });
    const strip = hall(page, '3').locator('xpath=..');
    const snap = await strip.evaluate((el) => getComputedStyle(el).scrollSnapType);
    expect(snap).toContain('x');
    expect(await strip.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
    expect(
      await hall(page, '3')
        .locator('[data-slot="hall-header"]')
        .evaluate((el) => getComputedStyle(el).position),
    ).toBe('sticky');
    expect(
      await page
        .locator('header', { has: page.locator('h1') })
        .evaluate((el) => getComputedStyle(el).position),
    ).toBe('sticky');
    const rail = page.locator('[data-day-rail]');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('heading', { name: 'Carry list' })).toBeVisible();
    await expect(rail.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    await expect(rail.getByText('WP(MD) 20001/2026')).toBeVisible();
    await expect(rail.getByText('WA 777/2025')).toBeVisible();
    await expect(rail.getByText('to confirm')).toBeVisible();
  });

  // R4
  test('a clash shows one factual card above the first item and a marker on both items', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db);
    for (const [no, other] of [
      ['3', '22'],
      ['7', '14'],
    ] as const) {
      const column = hall(page, no);
      const card = column.locator('[data-clash]');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('Clash');
      await expect(card).toContainText(/Items (14|22) \(Hall (3|7)\) and (14|22) \(Hall (3|7)\)/);
      await expect(card).toContainText(other);
      // Above the first item of the column.
      const above = await card.evaluate((el, selector) => {
        const first = el.closest('section')?.querySelector(selector);
        return first
          ? Boolean(el.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)
          : false;
      }, '[data-court-item]');
      expect(above).toBe(true);
      // Factual: no time, no order, no prediction.
      const text = (await card.innerText()).toLowerCase();
      expect(text).not.toMatch(
        /\d{1,2}[:.]\d{2}|\b(am|pm)\b|minute|hour|likely|probab|expect|soon|first|before|after|predict/,
      );
    }
    await expect(page.locator('[data-clash-marker]')).toHaveCount(2);
    await expect(item(hall(page, '3'), '14').locator('[data-clash-marker]')).toContainText('Clash');
    await expect(item(hall(page, '7'), '22').locator('[data-clash-marker]')).toContainText('Clash');
    // The clash marker is an icon plus text, never colour alone.
    await expect(item(hall(page, '3'), '14').locator('[data-clash-marker] svg')).toHaveCount(1);
    await expect(item(hall(page, '3'), '1').locator('[data-clash-marker]')).toHaveCount(0);
  });

  // R5
  test(
    'a list diff shows the banner, opens the sheet and flags the cards with text and an icon',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openBoard(page, asUser, db);
      const strip = page.locator('[data-attention-strip]');
      await expect(strip).toBeVisible();
      await expect(strip).toContainText('3 changes since the last list');
      // The live region announces the arrival politely.
      const live = page.locator('[data-diff-live]');
      await expect(live).toHaveAttribute('aria-live', 'polite');
      await expect(live).toHaveText('3 changes since the last list');

      const flags = [
        ['10', 'added', 'New'],
        ['14', 'moved', 'Moved from Hall 4'],
        ['12', 'removed', 'Removed'],
      ] as const;
      for (const [no, kind, text] of flags) {
        const flag = item(hall(page, '3'), no).locator(`[data-change="${kind}"]`);
        await expect(flag).toHaveText(text);
        await expect(flag.locator('svg')).toHaveCount(1);
      }
      await expect(item(hall(page, '3'), '1').locator('[data-change]')).toHaveCount(0);

      await strip.getByRole('button', { name: /See 3 changes/ }).click();
      const sheet = page.getByRole('dialog', { name: 'List changes' });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('Supplementary list');
      await expect(sheet).toContainText(`New: item 10, ${COURT_DAY.added}`);
      await expect(sheet).toContainText(`Moved from Hall 4: item 14, ${COURT_DAY.moved}`);
      await expect(sheet).toContainText(`Removed: item 12, ${COURT_DAY.removed}`);
      await expect(sheet.locator('svg')).toHaveCount(4); // three kinds plus the close icon
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    },
  );

  test('a day without a changed list has no diff banner', async ({ page, asUser, db }) => {
    await openBoard(page, asUser, db, { seed: { diff: false, failure: false } });
    await expect(page.locator('[data-attention-strip]')).toHaveCount(0);
    await expect(page.locator('[data-change]')).toHaveCount(0);
  });

  // R6
  test('court is at item N dims earlier items, draws the rule, persists and clears', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db);
    const column = hall(page, '3');
    const input = column.locator('[data-court-marker-input]');
    await input.fill('10');
    await input.press('Enter');
    await expect(column.locator('[data-court-is-at-rule]')).toBeVisible({ timeout: 15_000 });
    await expect(column.locator('[data-court-is-at-rule]')).toContainText('Court is at item 10');
    for (const no of ['1', '9']) await expect(item(column, no)).toHaveAttribute('data-dimmed', '');
    for (const no of ['10', '12', '14']) {
      await expect(item(column, no)).not.toHaveAttribute('data-dimmed', '');
    }
    // The rule sits between item 9 and item 10.
    const between = await column.locator('[data-court-is-at-rule]').evaluate((el) => {
      const next = el.parentElement?.querySelector('[data-court-item]');
      return next?.getAttribute('aria-label')?.startsWith('Item 10,') ?? false;
    });
    expect(between).toBe(true);

    // It persists, and another chamber member sees it.
    await page.reload();
    await contentReady(page);
    await expect(column.locator('[data-court-is-at-rule]')).toBeVisible();
    await asUser('advocate', { path: '/today' });
    await contentReady(page);
    await expect(column.locator('[data-court-is-at-rule]')).toBeVisible();
    await expect(item(column, '9')).toHaveAttribute('data-dimmed', '');
    await expect(column.locator('[data-court-marker-input]')).toBeVisible();

    await column.getByRole('button', { name: 'Clear' }).click();
    await expect(column.locator('[data-court-is-at-rule]')).toHaveCount(0);
    await expect(column.locator('[data-dimmed]')).toHaveCount(0);
    await page.reload();
    await contentReady(page);
    await expect(column.locator('[data-court-is-at-rule]')).toHaveCount(0);
  });

  test('a marker value that is not an item number is refused', async ({ page, asUser, db }) => {
    await openBoard(page, asUser, db);
    const column = hall(page, '3');
    await column.locator('[data-court-marker-input]').fill('x');
    await column.getByRole('button', { name: 'Set' }).click();
    await expect(column.getByRole('alert')).toHaveText('Enter an item number.');
    await expect(column.locator('[data-court-is-at-rule]')).toHaveCount(0);
  });

  // R7
  test(
    'an adapter failure shows the UJ-9 banner, keeps the last known data and offers the official list',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openBoard(page, asUser, db);
      const banner = page.locator('[data-adapter-failure]');
      await expect(banner).toHaveCount(1);
      await expect(banner).toHaveAttribute('role', 'alert');
      await expect(banner.locator('p').first()).toHaveText(
        /^Couldn't read today's .+ list for Hall 12\. Open the official list, or share it again\.$/,
      );
      await expect(banner).toContainText(/Last known data, read \d{1,2}:\d{2}/);
      // The last known data stays on screen.
      await expect(page.getByText(COURT_DAY.kannadaParty)).toBeVisible();
      await expect(hall(page, '3')).toBeVisible();
      // The official list opens in a new window, never framed.
      const official = banner.getByRole('link', { name: 'Open the official list' });
      await expect(official).toHaveAttribute('target', '_blank');
      await expect(official).toHaveAttribute('rel', /noopener/);
      await expect(official).toHaveAttribute('href', /^https?:\/\//);
      await expect(page.locator('iframe, embed, object')).toHaveCount(0);
      // Share it again goes to the capture inbox.
      await expect(banner.getByRole('link', { name: 'share it again.' })).toHaveAttribute(
        'href',
        /\/w\/chennai-solo\/inbox$/,
      );
    },
  );

  test('tomorrow carries no failure that belongs to today', async ({ page, asUser, db }) => {
    await openBoard(page, asUser, db, { path: '/tomorrow' });
    // The parse run was made today: it applies to today and to tomorrow (the evening list), and a
    // later day has none. Tomorrow has no Forum B item, so there is no banner to show.
    await expect(page.locator('[data-adapter-failure]')).toHaveCount(0);
  });

  // R8
  test(
    'an empty day shows the quiet empty state',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openBoard(page, asUser, db, { seed: { listings: false } });
      const empty = page.locator('[data-pattern-state="empty"]');
      await expect(empty).toBeVisible();
      await expect(empty).toContainText('Nothing listed');
      await expect(page.locator('[data-court-item]')).toHaveCount(0);
      await expect(page.locator('[data-attention-strip]')).toHaveCount(0);
    },
  );

  test('the board shows no layout shift while it loads', async ({ page, asUser, db }) => {
    await seedCourtDay(db);
    await page.setViewportSize(DESKTOP);
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await asUser('owner', { path: '/today' });
    await contentReady(page);
    await expect(page.locator('[data-court-item]').first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(
      0.01,
    );
  });

  test('a failed read shows the error boundary with retry', async ({ page, asUser, db }) => {
    await seedCourtDay(db);
    await page.setViewportSize(DESKTOP);
    await asUser('owner', { path: '/today?__state=error' });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('[data-court-item]')).toHaveCount(0);
  });

  test(
    'offline shows the banner with the time the data was read',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openBoard(page, asUser, db);
      await expect(page.locator('[data-offline-banner]')).toHaveCount(0);
      await page.context().setOffline(true);
      await expect(page.locator('[data-offline-banner]')).toBeVisible();
      await expect(page.locator('[data-offline-banner]')).toHaveText(
        /^Offline\. Showing data saved at \d{1,2}:\d{2}/,
      );
      // The last known data stays.
      await expect(item(hall(page, '3'), '14')).toBeVisible();
      await page.context().setOffline(false);
      await expect(page.locator('[data-offline-banner]')).toHaveCount(0);
    },
  );

  test('a clerk sees the board read-only with only what they appear in', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db, { role: 'clerk' });
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(page.getByText(COURT_DAY.sharedTitle)).toBeVisible();
    await expect(page.getByText(COURT_DAY.restrictedTitle)).toHaveCount(0);
    await expect(page.getByText('Anand v. Union of India')).toHaveCount(0);
    await expect(page.locator('[data-court-marker-input]')).toHaveCount(0);
    await expect(page.locator('[data-attention-strip] [data-diff-trigger]')).toHaveCount(0);
  });

  test('a viewer sees the board read-only and a restricted matter stays out', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db, { role: 'viewer' });
    await expect(page.getByText(COURT_DAY.sharedTitle)).toBeVisible();
    await expect(page.getByText(COURT_DAY.restrictedTitle)).toHaveCount(0);
    await expect(page.locator('[data-court-marker-input]')).toHaveCount(0);
    await item(page, '9').locator('[data-quick-actions]').click();
    const sheet = page.getByRole('dialog', { name: 'Quick actions' });
    await expect(sheet.getByRole('link', { name: 'Open the matter' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Court is at item/ })).toHaveCount(0);
  });

  test('the owner reads the restricted matter', async ({ page, asUser, db }) => {
    await openBoard(page, asUser, db);
    await expect(item(hall(page, '3'), '20')).toContainText(COURT_DAY.restrictedTitle);
  });

  // R9
  test('the board is operable by keyboard alone', async ({ page, asUser, db }) => {
    await openBoard(page, asUser, db);
    // j and k move focus down and up the items; the focus ring is visible.
    const items = page.locator('[data-court-item]');
    // The first press may land before the board's key handlers are bound; retry until it takes.
    await expect(async () => {
      await page.keyboard.press('j');
      await expect(items.first()).toBeFocused({ timeout: 1000 });
    }).toPass();
    const first = await items.first().getAttribute('aria-label');
    await page.keyboard.press('j');
    await expect(items.first()).not.toBeFocused();
    expect(await items.first().getAttribute('tabindex')).toBe('-1');
    await page.keyboard.press('k');
    await expect(page.locator('[data-court-item]:focus')).toHaveAttribute(
      'aria-label',
      first ?? '',
    );
    expect(
      await page
        .locator('[data-court-item]:focus')
        .evaluate((el) => getComputedStyle(el).boxShadow),
    ).not.toBe('none');
    // l and h move between halls.
    const hallOf = () =>
      page.evaluate(
        () =>
          document.activeElement?.closest('[data-hall-column]')?.getAttribute('aria-label') ?? '',
      );
    const start = await hallOf();
    await page.keyboard.press('l');
    const next = await hallOf();
    expect(next).not.toBe(start);
    await page.keyboard.press('h');
    expect(await hallOf()).toBe(start);
    // Enter opens the matter.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/matters\/[0-9a-f-]+/);
    await page.goBack();
    await contentReady(page);
    // m focuses the court-is-at control of the focused hall; d opens the diff sheet; o the actions.
    await page.keyboard.press('j');
    await page.keyboard.press('m');
    await expect(page.locator('[data-court-marker-input]:focus')).toHaveCount(1);
    await page.locator('[data-court-marker-input]:focus').blur();
    await page.keyboard.press('d');
    await expect(page.getByRole('dialog', { name: 'List changes' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    // Focus returns to the diff button; j starts again from the first item and o opens its actions.
    await expect(async () => {
      await page.keyboard.press('j');
      await page.keyboard.press('o');
      await expect(page.getByRole('dialog', { name: 'Quick actions' })).toBeVisible({
        timeout: 2000,
      });
    }).toPass();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    // c goes to the carry list; ? shows the shortcut sheet.
    await page.keyboard.press('c');
    await expect(page.locator('[data-carry-list]:focus')).toHaveCount(1);
    await page.keyboard.press('?');
    const help = page.getByRole('dialog');
    await expect(help).toBeVisible();
    // The sheet shows each key as a key cap in display case (`J`, `G then T`).
    for (const keys of ['j', 'k', 'h', 'l', 'g then t']) {
      await expect(help).toContainText(keys, { ignoreCase: true });
    }
    await page.keyboard.press('Escape');
  });

  test('/ focuses the hall rail and g t goes to Today', async ({ page, asUser, db }) => {
    await openBoard(page, asUser, db, { path: '/today', size: PHONE });
    await expect(async () => {
      await page.keyboard.press('/');
      await expect(page.locator('[data-hall-rail] a').first()).toBeFocused({ timeout: 1000 });
    }).toPass();
    await page.locator('[data-hall-rail] a').first().blur();
    await page
      .getByRole('navigation', { name: 'Court day' })
      .getByRole('link', { name: 'Tomorrow' })
      .click();
    await expect(page).toHaveURL(/\/tomorrow$/);
    await contentReady(page);
    await expect(async () => {
      await page.keyboard.press('g');
      await page.keyboard.press('t');
      await expect(page).toHaveURL(/\/today$/, { timeout: 1500 });
    }).toPass();
  });

  // R10
  test('items have a screen-reader name and diff arrivals a polite live region', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db);
    await expect(page.getByRole('region', { name: /./ }).first()).toBeVisible();
    await expect(hall(page, '3').locator('xpath=self::section')).toHaveAttribute(
      'aria-label',
      'Hall 3',
    );
    await expect(item(hall(page, '3'), '1')).toHaveAttribute(
      'aria-label',
      'Item 1, WP 12345/2026, Numbered, brief readiness not known',
    );
    await expect(item(hall(page, '3'), '14')).toHaveAttribute(
      'aria-label',
      'Item 14, WP(MD) 20001/2026, Part-heard, brief readiness not known, clash with another hall',
    );
    await expect(page.getByRole('article', { name: /^Item 22, WA 777\/2025,/ })).toContainText(
      'Kavitha v. Commissioner of Police',
    );
    const live = page.locator('[data-diff-live]');
    await expect(live).toHaveAttribute('role', 'status');
    await expect(live).toHaveAttribute('aria-live', 'polite');
  });

  // R11
  test('touch targets are at least 44 px and the actions sheet opens on long-press and Enter', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db, { size: PHONE });
    // The board streams in behind `main`: wait for its first card to be in the page and hydrated
    // (the server-rendered card has no handlers yet, so a press that lands earlier is lost), then
    // measure, so neither the target sizes nor the long-press race the stream.
    const firstCard = page.locator('section[data-hall-column]:visible [data-court-item]').first();
    await expect(firstCard).toBeVisible();
    await firstCard.evaluate(
      (el) =>
        new Promise<void>((resolve) => {
          const check = (): void => {
            if (Object.keys(el).some((key) => key.startsWith('__reactFiber$'))) resolve();
            else requestAnimationFrame(check);
          };
          check();
        }),
    );
    const controls = page.locator(
      [
        '[data-hall-rail] a',
        'nav[aria-label="Court day"] a',
        '[data-quick-actions]',
        '[data-diff-trigger]',
        'details summary',
      ].join(', '),
    );
    const visible = await controls.evaluateAll((els) =>
      els
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.textContent.trim().slice(0, 24), w: r.width, h: r.height };
        })
        .filter((r) => r.w > 0 && r.h > 0),
    );
    expect(visible.length).toBeGreaterThan(5);
    for (const control of visible) {
      expect(control.w, `${control.name} width`).toBeGreaterThanOrEqual(44);
      expect(control.h, `${control.name} height`).toBeGreaterThanOrEqual(44);
    }
    // The court-is-at control of the hall in view is at 44 px too.
    const marker = page.locator(
      'section[data-hall-column]:visible [data-court-is-at] :is(input, button)',
    );
    for (const box of await marker.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    )) {
      expect(box).toBeGreaterThanOrEqual(44);
    }

    // Long-press opens the sheet.
    const card = firstCard;
    // The first-run coachmark (#94) pushes the board down, so on a phone the first card can sit
    // under the bottom bar: bring it to the middle of the viewport before pressing it.
    await card.evaluate((el) => {
      el.scrollIntoView({ block: 'center' });
    });
    const box = await card.boundingBox();
    if (!box) throw new Error('no card box');
    await page.mouse.move(box.x + 60, box.y + 12);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    const sheet = page.getByRole('dialog', { name: 'Quick actions' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    // Enter and Space on the card's actions button open it too.
    for (const key of ['Enter', 'Space']) {
      await card.locator('[data-quick-actions]').focus();
      await page.keyboard.press(key);
      await expect(sheet).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    }
  });

  test('no swipe gesture is bound on the board', async ({ page, asUser, db }) => {
    await openBoard(page, asUser, db, { size: PHONE });
    const url = page.url();
    const card = page.locator('section[data-hall-column]:visible [data-court-item]').first();
    const box = await card.boundingBox();
    if (!box) throw new Error('no card box');
    const y = box.y + 12;
    for (const [from, to] of [
      [box.x + box.width - 20, box.x + 20],
      [box.x + 20, box.x + box.width - 20],
    ] as const) {
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(to, y, { steps: 8 });
      await page.mouse.up();
    }
    await page.waitForTimeout(700);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url()).toBe(url);
    await expect(page.locator('[data-court-is-at-rule], [data-dimmed]')).toHaveCount(0);
  });

  // R12
  test('Tamil and Kannada party names render in full without clipping', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db);
    const fits = async (name: string) => {
      const el = page.getByText(name);
      await expect(el).toBeVisible();
      const fit = await el.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          wide: node.scrollWidth <= node.clientWidth + 1,
          tall: node.scrollHeight <= node.clientHeight + 1,
          leading: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
        };
      });
      expect(fit.wide).toBe(true);
      expect(fit.tall).toBe(true);
      expect(fit.leading).toBeGreaterThanOrEqual(1.2);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    };
    await fits(COURT_DAY.tamilParty);
    await fits(COURT_DAY.kannadaParty);
    // On a phone the hall in view changes with the rail; the names still fit.
    await page.setViewportSize(PHONE);
    await page
      .locator('[data-hall-rail]')
      .getByRole('link', { name: /^Hall 7/ })
      .click();
    await fits(COURT_DAY.tamilParty);
    await page
      .locator('[data-hall-rail]')
      .getByRole('link', { name: /^Hall 1/ })
      .click();
    await fits(COURT_DAY.kannadaParty);
  });

  // D-050
  test('the board predicts no call time and shows no judge statistic', async ({
    page,
    asUser,
    db,
  }) => {
    await openBoard(page, asUser, db, { benchFacts: true });
    const board = page.locator('[data-court-day-board]');
    const text = await board.innerText();
    // With `bench_facts` on, the bench a listing is before shows, as cause-list content.
    await expect(hall(page, '3')).toContainText(COURT_DAY.judge);
    expect(text).not.toMatch(
      /likely|probab|predict|estimat|expected to be (called|heard)|rating|win rate|grant rate|success rate|average|analytics|statistic/i,
    );
    expect(text).not.toMatch(/\b\d{1,3}\s?%/);
  });

  // D-050: who sat is a bench fact, behind `bench_facts` (off until counsel clears it, #118).
  test('with bench_facts off the board names no judge', async ({ page, asUser, db }) => {
    await openBoard(page, asUser, db);
    await expect(hall(page, '3')).toBeVisible();
    await expect(page.locator('[data-hall-bench]')).toHaveCount(0);
    expect(await page.locator('[data-court-day-board]').innerText()).not.toContain(COURT_DAY.judge);
  });
});
