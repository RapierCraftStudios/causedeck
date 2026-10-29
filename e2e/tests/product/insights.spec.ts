// Practice insights (#966, follow-up of #85) on `/w/chennai-solo/insights`: the flag is on and six
// past hearings are seeded (see fixtures/insights-data.ts for the figures they read as). Covers the
// Prepared & Kept hero, the range picker by link and by the `[` and `]` keys, the table
// alternative by button and by `t`, a junior who sees only their own appearances, and the denied
// state for a clerk and a viewer. The `@a11y` tests end on the state they name, so axe (zero
// serious or critical) runs on them in the light and dark projects. Visual baselines are in
// insights.visual.spec.ts, the flag-off route in insights-gated-off.spec.ts. Runs in CI only.
import { expect as baseExpect, test } from '../../fixtures/index.ts';
import { INSIGHTS_EXPECTED } from '../../fixtures/insights-data.ts';

import { heroRate, openInsights, route, tile } from './insights-helpers.ts';

// A client navigation renders a dynamic route and the page computes from Postgres.
const expect = baseExpect.configure({ timeout: 15_000 });

const E = INSIGHTS_EXPECTED;

test.describe('practice insights', () => {
  test.describe.configure({ timeout: 90_000 });

  test(
    'shows the Prepared & Kept hero with its reading and definition',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openInsights(page, asUser, db.name);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Practice insights' }),
      ).toBeVisible();
      await expect(heroRate(page)).toHaveText(E.owner12w.percent);
      await expect(route(page)).toContainText(
        `Prepared and kept: 83 percent of ${String(E.owner12w.appearances)} appearances.`,
      );
      await expect(route(page)).toContainText('Totals for this workspace.');
      await expect(route(page).getByRole('link', { name: '12 weeks' })).toHaveAttribute(
        'aria-current',
        'true',
      );
      const definition = route(page).getByText('What counts as prepared and kept');
      await definition.click();
      await expect(route(page)).toContainText('every obligation arising from that hearing');
      // The quieter tiles: no obligations were seeded, five ratings are enough for preparedness.
      await expect(tile(page, 'Obligations kept')).toBeVisible();
      await expect(tile(page, 'Preparedness')).toContainText(E.preparednessAverage);
      await expect(tile(page, 'Load')).toContainText(
        'Load appears after at least 5 weekly pulses.',
      );
    },
  );

  test('an advocate sees the workspace totals', async ({ page, asUser, db }) => {
    await openInsights(page, asUser, db.name, { role: 'advocate' });
    await expect(heroRate(page)).toHaveText(E.owner12w.percent);
    await expect(route(page)).toContainText('Totals for this workspace.');
  });

  test('the range picker changes the range by link', async ({ page, asUser, db }) => {
    await openInsights(page, asUser, db.name);
    await route(page).getByRole('link', { name: '4 weeks' }).click();
    await expect(page).toHaveURL(/[?&]range=4w\b/);
    await expect(heroRate(page)).toHaveText(E.owner4w.percent);
    await expect(route(page)).toContainText(
      `Prepared and kept: 100 percent of ${String(E.owner4w.appearances)} appearances. ` +
        `Previous period: 67 percent.`,
    );
    await expect(route(page).getByRole('link', { name: '4 weeks' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await route(page).getByRole('link', { name: 'Custom' }).click();
    await expect(page).toHaveURL(/[?&]range=custom\b/);
    await expect(route(page).getByLabel('From')).toBeVisible();
    await expect(route(page).getByLabel('To')).toBeVisible();
  });

  test('[ and ] step the range, by keyboard only', async ({ page, asUser, db }) => {
    await openInsights(page, asUser, db.name);
    await expect(heroRate(page)).toHaveText(E.owner12w.percent);
    await page.keyboard.press('[');
    await expect(page).toHaveURL(/[?&]range=4w\b/);
    await expect(heroRate(page)).toHaveText(E.owner4w.percent);
    await page.keyboard.press(']');
    await expect(page).toHaveURL(/[?&]range=12w\b/);
    await expect(heroRate(page)).toHaveText(E.owner12w.percent);
  });

  test('t switches the charts to their data tables and back', async ({ page, asUser, db }) => {
    await openInsights(page, asUser, db.name);
    const preparedness = tile(page, 'Preparedness');
    await preparedness.getByRole('button', { name: 'Show chart and data' }).click();
    await expect(preparedness.locator('[data-slot="insights-chart"]')).toBeVisible();
    await expect(preparedness.locator('[data-slot="insights-data-table"]')).toHaveCount(0);
    await page.keyboard.press('t');
    const table = preparedness.locator('[data-slot="insights-data-table"]');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Average' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Answers' })).toBeVisible();
    await expect(preparedness.locator('[data-slot="insights-chart"]')).toHaveCount(0);
    await page.keyboard.press('t');
    await expect(preparedness.locator('[data-slot="insights-chart"]')).toBeVisible();
    // The button does the same as the key.
    await preparedness.getByRole('button', { name: 'Show data table' }).click();
    await expect(table).toBeVisible();
    await preparedness.getByRole('button', { name: 'Show chart' }).click();
    await expect(preparedness.locator('[data-slot="insights-chart"]')).toBeVisible();
  });

  test('the hero has its own weekly data table', { tag: '@a11y' }, async ({ page, asUser, db }) => {
    await openInsights(page, asUser, db.name);
    const hero = route(page).locator('[data-slot="insights-hero"]');
    await hero.getByRole('button', { name: 'Show data table' }).click();
    const table = hero.locator('[data-slot="insights-data-table"]');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Appearances' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Rate' })).toBeVisible();
    await expect(table.getByRole('row')).not.toHaveCount(1);
  });

  test(
    'a junior sees only their own appearances',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openInsights(page, asUser, db.name, { role: 'junior' });
      await expect(route(page)).toContainText('Your own appearances and measures only.');
      await expect(route(page)).not.toContainText('Totals for this workspace.');
      await expect(heroRate(page)).toHaveText(E.junior12w.percent);
      await expect(route(page)).toContainText(
        `Prepared and kept: 50 percent of ${String(E.junior12w.appearances)} appearances.`,
      );
      await expect(route(page)).toContainText('Small sample: only 2 appearances.');
      // The owner's five ratings are not the junior's.
      await expect(tile(page, 'Preparedness')).toContainText(
        'Preparedness appears after at least 5 ratings. Ratings so far: 0.',
      );
    },
  );

  test('shows the empty state before any court day', async ({ page, asUser, db }) => {
    await openInsights(page, asUser, db.name, { seed: false });
    await expect(
      route(page).getByRole('heading', { name: 'Insights appear after your first few court days' }),
    ).toBeVisible();
    await expect(heroRate(page)).toHaveCount(0);
  });

  for (const role of ['clerk', 'viewer'] as const) {
    test(`a ${role} is denied`, { tag: '@a11y' }, async ({ page, asUser, db }) => {
      await openInsights(page, asUser, db.name, { role });
      const main = page.locator('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText('No access');
      await expect(main).toContainText('You do not have access to this area.');
      await expect(page.locator('[data-route="insights"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="insights-hero-rate"]')).toHaveCount(0);
      // The nav has no entry for a role that cannot read it.
      await expect(page.locator('a[href$="/insights"]')).toHaveCount(0);
    });
  }
});
