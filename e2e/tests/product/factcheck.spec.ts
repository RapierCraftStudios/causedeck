// Fact-check journeys (#917, part 5 of #170): the live check in the drafting studio, the composer
// (`/updates`) and the Brief Sheet synopsis note. Only the rule pass runs in the e2e stack (no model),
// so claims are case numbers against the seeded appeal matter. `@a11y` tests end on the state they
// name, so axe runs on it in the light and dark projects. Runs in CI only; fictional data.
// The export-gate acknowledgement has no UI yet (acknowledgeFactCheckAction is not wired in the
// studio), so only the squiggle and panel flows are covered here.
import { expect, test } from '../../fixtures/index.ts';
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { contentReady } from '../shell/helpers.ts';

import { openBrief } from './brief-helpers.ts';
import {
  FACT_STUDIO,
  MISMATCH_TEXT,
  NEUTRAL_TEXT,
  RECORD_CASE,
  SECOND_MISMATCH_TEXT,
  block,
  panel,
  seedFactDraft,
  squiggles,
} from './factcheck-helpers.ts';
import { DRAFTS_PATH, seedDrafts } from './outward-drafts-helpers.ts';

const WIDE = { width: 1280, height: 900 };

test.describe('fact check in the studio', () => {
  test.beforeEach(async ({ page, asUser, db }) => {
    await seedFactDraft(db.name);
    await page.setViewportSize(WIDE);
    await asUser('owner', { workspace: MATTERS_WORKSPACE, path: FACT_STUDIO });
    await contentReady(page);
  });

  test('flags a figure that differs from the record within a second, with its source', async ({
    page,
  }) => {
    await block(page, 'b5').fill(SECOND_MISMATCH_TEXT);
    const second = page.locator('[data-slot="fact-squiggle"][data-status="mismatch"]', {
      hasText: 'W.A. No. 211 of 2025',
    });
    await expect(second).toBeVisible({ timeout: 1000 });
    await second.click();
    const card = page.locator('[data-slot="fact-card"][data-status="mismatch"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-slot="fact-quote"]')).toContainText('WA 210/2025');
    await expect(card.locator('[data-slot="fact-meta"]')).toContainText('proceeding:');
  });

  test('marks an unsupported claim as the lawyer’s own assertion', async ({ page }) => {
    const unsupported = squiggles(page, 'unsupported');
    await expect(unsupported).toHaveCount(1);
    await unsupported.click();
    await page.getByRole('button', { name: 'Mark as my assertion' }).click();
    await expect(panel(page).locator('[data-group="unsupported"]')).toHaveCount(0);
    await expect(panel(page)).toContainText('Your assertion');
    await expect(squiggles(page, 'unsupported')).toHaveCount(0);
  });

  test('fixes a mismatch from the record, then undoes it', async ({ page }) => {
    await squiggles(page, 'mismatch').click();
    await page.getByRole('button', { name: 'Fix', exact: true }).click();
    await expect(block(page, 'b2')).toHaveValue(new RegExp(RECORD_CASE));
    await expect(panel(page).getByText('Fixed. You can undo this.')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Undo fix' }).click();
    await expect(block(page, 'b2')).toHaveValue(MISMATCH_TEXT);
  });

  test('ignores a finding for this matter and for this view', async ({ page }) => {
    await squiggles(page, 'mismatch').click();
    await page.getByRole('button', { name: 'Ignore for this matter' }).click();
    await expect(panel(page)).toContainText('Ignored for this matter');
    await expect(squiggles(page, 'mismatch')).toHaveCount(0);

    await squiggles(page, 'unsupported').click();
    await page.getByRole('button', { name: 'Ignore', exact: true }).click();
    await expect(squiggles(page, 'unsupported')).toHaveCount(0);
  });

  test('lists issues in the Facts panel with a count, and shows the empty state', async ({
    page,
  }) => {
    await expect(panel(page).locator('[data-group="mismatch"]')).toBeVisible();
    await expect(panel(page).locator('[data-group="unsupported"]')).toBeVisible();
    await expect(panel(page).locator('[data-slot="fact-check-badge"]')).toHaveAttribute(
      'aria-label',
      '2 fact-check issues',
    );
    await panel(page)
      .getByRole('button', { name: /^Go to claim: Does not match/ })
      .click();
    await expect(block(page, 'b2')).toBeFocused();

    await block(page, 'b2').fill(NEUTRAL_TEXT);
    await block(page, 'b3').fill(NEUTRAL_TEXT);
    await expect(panel(page).locator('[data-slot="fact-check-empty"]')).toBeVisible();
    await expect(panel(page).locator('[data-slot="fact-check-badge"]')).toHaveCount(0);
  });

  test('moves between issues with F8 and Shift+F8', async ({ page }) => {
    await block(page, 'b1').click();
    await page.keyboard.press('F8');
    await expect(squiggles(page).first()).toBeFocused();
    await expect(page.locator('[data-slot="fact-live-region"]')).toContainText(/Issue 1 of 2/);
    await page.keyboard.press('F8');
    await expect(squiggles(page).nth(1)).toBeFocused();
    await page.keyboard.press('Shift+F8');
    await expect(squiggles(page).first()).toBeFocused();
  });

  test('shows the count in the toolbar on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const badge = page.locator('header [data-slot="fact-check-badge"]');
    await expect(badge).toHaveAttribute('aria-label', '2 fact-check issues');
    await page
      .locator('header')
      .getByRole('button', { name: /^Fact check/ })
      .click();
    await expect(page.locator('[data-slot="fact-check-panel"]').first()).toBeVisible();
  });

  test(
    'has no serious axe violations with a verdict card open',
    { tag: '@a11y' },
    async ({ page }) => {
      await squiggles(page, 'mismatch').click();
      await expect(page.locator('[data-slot="fact-card"]')).toBeVisible();
    },
  );
});

test.describe('fact check in the composer and the Brief Sheet', () => {
  test('checks an outward draft as it is typed', { tag: '@a11y' }, async ({ page, asUser, db }) => {
    const drafts = await seedDrafts(db.name);
    await asUser('owner', { path: `${DRAFTS_PATH}?draft=${drafts.client}` });
    await contentReady(page);
    await page.getByRole('textbox', { name: /^Draft text for / }).fill(MISMATCH_TEXT);
    const line = page.locator('[data-slot="fact-line"]');
    await expect(line.locator('[data-slot="fact-squiggle"][data-status="mismatch"]')).toBeVisible();
  });

  test('checks the synopsis note as it is typed', { tag: '@a11y' }, async ({ page, asUser }) => {
    await openBrief(page, asUser);
    await page.locator('[data-edit-synopsis]').click();
    await page.locator('[data-brief-sheet] form textarea').fill(MISMATCH_TEXT);
    const line = page.locator('[data-brief-sheet] [data-slot="fact-line"]');
    await expect(line.locator('[data-slot="fact-squiggle"][data-status="mismatch"]')).toBeVisible();
  });
});
