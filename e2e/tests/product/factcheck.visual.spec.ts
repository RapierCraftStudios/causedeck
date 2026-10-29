// Fact-check visual baselines (#917): the squiggle states in the studio (mismatch, unsupported, a
// verdict card open, none) at 360, 768 and 1280 px in light and dark (the viewport and theme
// projects). Baselines are generated and compared in CI.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { contentReady } from '../shell/helpers.ts';

import { FACT_STUDIO, NEUTRAL_TEXT, block, seedFactDraft, squiggles } from './factcheck-helpers.ts';

test.describe('fact check visual', { tag: '@visual' }, () => {
  test.beforeEach(async ({ page, asUser, db }) => {
    await seedFactDraft(db.name);
    await asUser('owner', { workspace: MATTERS_WORKSPACE, path: FACT_STUDIO });
    await contentReady(page);
    await expect(squiggles(page)).toHaveCount(2);
  });

  const editor = (page: Page) => page.getByRole('main', { name: 'Draft editor' });

  test('mismatch and unsupported squiggles', async ({ page }) => {
    await expect(editor(page)).toHaveScreenshot('factcheck-squiggles.png', {
      animations: 'disabled',
    });
  });

  test('verdict card open', async ({ page }) => {
    await squiggles(page, 'mismatch').click();
    await expect(page.locator('[data-slot="fact-card"]')).toBeVisible();
    await expect(page).toHaveScreenshot('factcheck-card.png', { animations: 'disabled' });
  });

  test('no issues', async ({ page }) => {
    await block(page, 'b2').fill(NEUTRAL_TEXT);
    await block(page, 'b3').fill(NEUTRAL_TEXT);
    await expect(squiggles(page)).toHaveCount(0);
    await expect(editor(page)).toHaveScreenshot('factcheck-none.png', { animations: 'disabled' });
  });
});
