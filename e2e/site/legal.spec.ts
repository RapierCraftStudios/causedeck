// Legal pages (#95) over the exported site: layout, draft banner, required statements, print, axe
// and visual baselines in every viewport x theme project (playwright.site.config.ts). While the
// pages are drafts the banner and noindex are asserted; update this when counsel marks them final.
import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { expectNoViolations } from '../fixtures/a11y.ts';

const PAGES = [
  { path: '/legal/terms/', title: 'Terms of Service' },
  { path: '/legal/privacy/', title: 'Privacy Policy' },
  { path: '/legal/dpa/', title: 'Data Processing Agreement' },
  { path: '/legal/ai-disclosure/', title: 'AI Disclosure' },
  { path: '/legal/sub-processors/', title: 'Sub-processors' },
];

for (const legal of PAGES) {
  test.describe(legal.path, () => {
    test('has the consistent layout, banner and noindex @a11y', async ({ page }) => {
      await page.goto(legal.path);
      await expect(page.getByRole('heading', { level: 1, name: legal.title })).toBeVisible();
      await expect(page.getByText('Version', { exact: true }).first()).toBeAttached();
      await expect(page.getByText('Effective date', { exact: true }).first()).toBeAttached();
      await expect(page.getByRole('navigation', { name: 'On this page' }).first()).toBeAttached();
      await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
      await expect(page.getByText('Draft pending counsel review')).toBeVisible();
      await expect(page.getByText('This document is available in English only.')).toBeVisible();
      expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain(
        'noindex',
      );
      await expectNoViolations(page);
    });

    test('print hides the site chrome', async ({ page }) => {
      await page.goto(legal.path);
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('header').first()).toBeHidden();
      await expect(page.locator('footer')).toBeHidden();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    test('matches the visual baseline @visual', async ({ page }, testInfo) => {
      const file = `${legal.path.split('/')[2] ?? 'legal'}.png`;
      test.skip(
        testInfo.config.updateSnapshots === 'none' &&
          !existsSync(testInfo.snapshotPath(file, { kind: 'screenshot' })),
        'no baseline yet: dispatch the site workflow with update_snapshots',
      );
      await page.goto(legal.path);
      await expect(page.locator('main')).toHaveScreenshot(file);
    });
  });
}

test('the AI disclosure states each point plainly', async ({ page }) => {
  await page.goto('/legal/ai-disclosure/');
  const main = page.locator('main');
  await expect(main).toContainText('India-only mode is on by default');
  await expect(main).toContainText('AI proposes and the lawyer confirms');
  await expect(main).toContainText('AI outputs may be wrong');
  await expect(main).toContainText('Customer content is not used to train models');
  await expect(main).toContainText('Citations are never generated');
  await expect(main).toContainText('Bedrock');
  await expect(main).toContainText('Sarvam');
});

test('the DPA names the roles and links to sub-processors and security', async ({ page }) => {
  await page.goto('/legal/dpa/');
  const main = page.locator('main');
  await expect(main).toContainText('Data Fiduciary: the advocate or chamber');
  await expect(main).toContainText('Data Processor: CauseDeck');
  await expect(main.getByRole('link', { name: 'sub-processor list' })).toHaveAttribute(
    'href',
    '/legal/sub-processors/',
  );
  await expect(main.getByRole('link', { name: 'security page' })).toHaveAttribute(
    'href',
    '/security/',
  );
});

test('Terms and About state the positioning', async ({ page }) => {
  for (const path of ['/legal/terms/', '/about/']) {
    await page.goto(path);
    await expect(page.locator('main')).toContainText('software for advocates, not legal services');
  }
});

test('the sub-processor table shows purpose, data categories, region and date', async ({
  page,
}) => {
  await page.goto('/legal/sub-processors/');
  for (const name of ['Purpose', 'Data categories', 'Region', 'Effective date']) {
    await expect(page.getByRole('columnheader', { name })).toBeVisible();
  }
  await expect(page.locator('tr[data-subprocessor]')).toHaveCount(8);
  const feed = await page.request.get('/legal/sub-processors/feed.xml');
  expect(feed.status()).toBe(200);
  expect(await feed.text()).toContain('<rss');
});
