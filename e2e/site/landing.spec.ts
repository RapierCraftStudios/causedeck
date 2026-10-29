// Landing page (#90): above the fold, positioning, Rule 36 text, sample-data labels, trust links,
// CTA targets, privacy (no form, no cookies), axe and visual baselines. Runs in light and dark at
// 360, 768 and 1280 px (playwright.site.config.ts). Baselines are generated in the pinned image only.
import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { expectNoViolations } from '../fixtures/a11y.ts';

const POSITIONING =
  'CauseDeck is software for advocates. It does not provide legal services or legal advice, and it does not advertise or recommend any lawyer.';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('above the fold: headline, subhead, both CTAs and the product visual', async ({ page }) => {
  const viewportHeight = page.viewportSize()?.height ?? 0;
  const parts = [
    page.getByRole('heading', { level: 1, name: 'Walk into court prepared.' }),
    page.getByText('CauseDeck is software for advocates: it reads your cause lists'),
    page.getByRole('link', { name: 'Start free' }).first(),
    page.getByRole('link', { name: 'See how a court day runs' }),
    page.getByTestId('court-day-preview'),
  ];
  for (const part of parts) {
    await expect(part).toBeVisible();
    const box = await part.boundingBox();
    expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(viewportHeight);
  }
});

test('the hero says what it is and never calls itself legal services', async ({ page }) => {
  const hero = page.locator('#hero-title').locator('xpath=ancestor::section[1]');
  await expect(hero).toContainText('software for advocates');
  expect(await hero.innerText()).not.toMatch(/legal services/i);
});

test('the positioning line is visible near the footer', async ({ page }) => {
  const line = page.getByTestId('positioning-line');
  await expect(line).toHaveText(POSITIONING);
  await line.scrollIntoViewIfNeeded();
  await expect(line).toBeVisible();
});

test('Rule 36: no testimonials, outcomes, listings or language for litigants', async ({ page }) => {
  const text = await page.locator('body').innerText();
  const withoutPositioning = text.replace(POSITIONING, '');
  for (const pattern of [
    /testimonial/i,
    /(customer|client|user) reviews?/i,
    /\bratings?\b/i,
    /case outcomes?/i,
    /win rate/i,
    /success stor/i,
    /find an? (lawyer|advocate)/i,
    /lawyer (directory|listings?)/i,
    /trusted by/i,
    /litigants?/i,
  ]) {
    expect(withoutPositioning).not.toMatch(pattern);
  }
});

test('automation copy says prepares and proposes, never files or sends', async ({ page }) => {
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\b(files|sends)\b|handles? [^.]*for you/i);
});

test('product visuals are labelled as sample data', async ({ page }) => {
  expect(await page.getByText('Illustrative, sample data').count()).toBeGreaterThanOrEqual(2);
  const preview = page.getByTestId('court-day-preview');
  await expect(preview.getByText('Illustrative, sample data')).toBeVisible();
  // The board itself is decorative: hidden from assistive tech, described by the hero text.
  expect(await preview.locator('[aria-hidden="true"]').count()).toBeGreaterThan(0);
});

test('trust claims link into the security page', async ({ page }) => {
  const links = page.locator('#trust').getByRole('link');
  expect(await links.count()).toBe(5);
  for (const href of await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')))) {
    expect(href).toMatch(/^\/security\/#[a-z-]+$/);
  }
});

test('the primary CTA goes to the app sign-in or the contact page; nothing collects data', async ({
  page,
  context,
}) => {
  const href = await page.getByRole('link', { name: 'Start free' }).first().getAttribute('href');
  expect(href).toMatch(/\/sign-in$|^\/contact\/$/);
  expect(await page.locator('form, input, textarea, select').count()).toBe(0);
  expect(await page.locator('dialog, [role="dialog"]').count()).toBe(0);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe('');
});

test('the landing page is accessible @a11y', async ({ page }) => {
  await expectNoViolations(page);
});

test('no horizontal overflow and a sound heading order', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const levels = await page
    .locator('h1, h2, h3')
    .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
  expect(levels[0]).toBe(1);
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  levels.slice(1).forEach((level, index) => {
    expect(level - (levels[index] ?? 0)).toBeLessThanOrEqual(1);
  });
});

test('landing page @visual', async ({ page }, testInfo) => {
  const file = 'landing.png';
  test.skip(
    testInfo.config.updateSnapshots === 'none' &&
      !existsSync(testInfo.snapshotPath(file, { kind: 'screenshot' })),
    'no baseline yet: dispatch the site workflow with update_snapshots',
  );
  await expect(page).toHaveScreenshot(file, { fullPage: true });
});
