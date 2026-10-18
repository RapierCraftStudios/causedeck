// One screenshot test per story, theme and width (cases from visual/stories.ts).
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { readIndex, storyUrl, VIEWPORT_HEIGHT, visualCases } from './stories';

const cases = visualCases(readIndex(path.join(import.meta.dirname, '..', 'storybook-static')));

for (const { id, title, name, theme, width, snapshot } of cases) {
  test(`${title} / ${name} [${theme} ${String(width)}]`, async ({ page }) => {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await page.goto(storyUrl(id, theme));
    // Storybook adds `sb-show-main` once the story has rendered (`sb-show-errordisplay` on error).
    await expect(page.locator('body')).toHaveClass(/sb-show-main/);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(snapshot.split('/'), { fullPage: true });
  });
}
