// Drafting a11y (#829): axe (zero serious or critical) on the drafts list and the studio in light
// and dark, and the template-picker dialog's focus trap and restore; the ack and export dialogs' focus
// trap, restore and axe (#910). Runs in CI only.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { DRAFTING, DRAFTING_WORKSPACE } from '../../fixtures/drafting-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';
import {
  CITED_STUDIO,
  checkCitations,
  citationPanel,
  seedCitedDraft,
} from '../product/drafting-helpers.ts';

const PATHS = { list: 'drafts', studio: `drafts/${DRAFTING.draft.id}` } as const;

async function seriousViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
  const results = await (include === undefined ? builder : builder.include(include)).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test.describe('drafting a11y', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [name, path] of Object.entries(PATHS)) {
      test(`${name} has no serious or critical axe violations (${scheme})`, async ({
        page,
        asUser,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await asUser('owner', { workspace: DRAFTING_WORKSPACE, path });
        await contentReady(page);
        expect(await seriousViolations(page)).toEqual([]);
      });
    }
  }

  test('the template picker traps focus and restores it on close', async ({ page, asUser }) => {
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: PATHS.list });
    await contentReady(page);
    const trigger = page.locator('[data-drafts-action="new"]').first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    expect(await seriousViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  for (const kind of ['ack', 'export'] as const) {
    test(`the ${kind} dialog traps focus, restores it on close and has no serious violations`, async ({
      page,
      asUser,
      db,
    }) => {
      await seedCitedDraft(db.name);
      await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: CITED_STUDIO });
      await contentReady(page);
      await checkCitations(page);
      const trigger =
        kind === 'ack'
          ? citationPanel(page).getByRole('button', { name: 'Acknowledge not-found citations' })
          : page.getByRole('button', { name: 'Export', exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.locator(`[data-slot="${kind}-dialog"]`);
      await expect(dialog).toBeVisible();
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      expect(await seriousViolations(page, `[data-slot="${kind}-dialog"]`)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  }
});
