// Pricing, security, about and changelog (#91) over the exported site: required content, price
// rendering, the plan toggle without JavaScript, links and visual baselines (generated in CI only,
// like the legal pages). Axe and metadata for these routes run in smoke.spec.ts.
import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { expectNoViolations } from '../fixtures/a11y.ts';

test('pricing shows the plans in rupees, the GST note and UPI Autopay', async ({ page }) => {
  await page.goto('/pricing/');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
  for (const plan of ['Junior', 'Advocate', 'Chamber']) {
    await expect(main.getByRole('heading', { name: plan, level: 3 })).toBeVisible();
  }
  await expect(main).toContainText('₹499');
  await expect(main).toContainText('18% GST');
  await expect(main).toContainText('UPI Autopay');
  await expect(main).toContainText('Clerk seat');
});

test('the billing toggle switches the Advocate price with no script', async ({ page }) => {
  await page.goto('/pricing/');
  await expect(page.getByText('₹4,990')).toBeHidden();
  // The radio is visually hidden (sr-only); a visitor clicks its label.
  await page.locator('label[for="bill-year"]').click();
  await expect(page.locator('#bill-year')).toBeChecked();
  await expect(page.getByText('₹4,990')).toBeVisible();
  await expect(page.getByText('₹499 ').first()).toBeHidden();
});

test('plan buttons go to sign-in with a plan parameter', async ({ page }) => {
  await page.goto('/pricing/');
  for (const plan of ['junior', 'advocate', 'chamber']) {
    const href = await page
      .locator(`a[href*="/sign-in?plan=${plan}"]`)
      .first()
      .getAttribute('href');
    expect(href).toContain(`plan=${plan}`);
  }
});

test('security lists the controls with proof and the compliance posture', async ({ page }) => {
  await page.goto('/security/');
  const main = page.locator('main');
  await expect(main.getByRole('navigation', { name: 'On this page' })).toBeVisible();
  await expect(main.getByRole('table')).toBeVisible();
  await expect(main.getByRole('img', { name: 'Where your data goes' })).toBeVisible();
  await expect(main).toContainText('six hours');
  await expect(main).toContainText('180 days');
  await expect(main.getByRole('link', { name: 'sub-processor list' }).first()).toHaveAttribute(
    'href',
    '/legal/sub-processors/',
  );
  for (const id of [
    'data-in-india',
    'ai-processing',
    'you-stay-in-control',
    'no-training',
    'sources',
  ]) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }
});

test('about states the positioning and the permanent exclusions', async ({ page }) => {
  await page.goto('/about/');
  const main = page.locator('main');
  await expect(main).toContainText('software for advocates');
  for (const text of ['No directory of lawyers', 'No ratings or rankings', 'No lead generation']) {
    await expect(main).toContainText(text);
  }
});

test('the changelog lists releases newest first with an RSS feed', async ({ page, request }) => {
  await page.goto('/changelog/');
  await expect(page.locator('main time').first()).toBeVisible();
  const feed = await request.get('/changelog/feed.xml');
  expect(feed.status()).toBe(200);
  expect(await feed.text()).toContain('<rss');
});

for (const route of ['/pricing/', '/security/', '/about/', '/changelog/']) {
  test(`${route} has no serious accessibility violations @a11y`, async ({ page }) => {
    await page.goto(route);
    await expectNoViolations(page);
  });

  test(`${route} matches the visual baseline @visual`, async ({ page }, testInfo) => {
    const file = `${route.split('/')[1] ?? 'page'}.png`;
    test.skip(
      testInfo.config.updateSnapshots === 'none' &&
        !existsSync(testInfo.snapshotPath(file, { kind: 'screenshot' })),
      'no baseline yet: dispatch the site workflow with update_snapshots',
    );
    await page.goto(route);
    await expect(page.locator('main')).toHaveScreenshot(file);
  });
}
