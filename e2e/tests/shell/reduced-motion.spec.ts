// Reduced motion (#11): sidebar collapse, palette and sheet transitions are instant under
// `prefers-reduced-motion`. Every project runs with `reducedMotion: 'reduce'`; each check is paired
// with a `no-preference` run of the same interaction, so it cannot pass just because nothing ever
// animates.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';

import {
  INSTANT_MS,
  durationsMs,
  layoutOf,
  openShell,
  palette,
  shellRoot,
  sidebar,
} from './helpers.ts';

type Preference = 'reduce' | 'no-preference';

async function prepare(page: Page, preference: Preference) {
  await page.emulateMedia({ reducedMotion: preference });
}

/** Longest of the element's transition and animation durations, once it is open. */
async function motionMs(locator: Locator): Promise<number> {
  await expect(locator).toBeVisible();
  const { transition, animation } = await durationsMs(locator);
  return Math.max(transition, animation);
}

/**
 * Press `[` and sample the sidebar width on the next two frames. Instant motion lands on the final
 * width at once; the 200 ms transition is still in between.
 */
async function sidebarWidthsAfterToggle(page: Page): Promise<{ next: number; final: number }> {
  const next = await page.evaluate(async () => {
    const aside = document.getElementById('shell-sidebar');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
    const frame = () =>
      new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
    await frame();
    await frame();
    return aside?.getBoundingClientRect().width ?? 0;
  });
  await expect(shellRoot(page)).toHaveAttribute('data-sidebar', /expanded|collapsed/);
  await page.waitForTimeout(400);
  const final = (await sidebar(page).boundingBox())?.width ?? 0;
  return { next, final };
}

test.describe('reduced motion', () => {
  test('sidebar collapse is instant', async ({ page, asUser }) => {
    test.skip(layoutOf(page) === 'phone', 'no sidebar on phones');
    await openShell(page, asUser);

    await expect(shellRoot(page)).toHaveAttribute('data-reduced-motion', 'true');
    expect((await durationsMs(shellRoot(page))).transition).toBeLessThanOrEqual(INSTANT_MS);
    const reduced = await sidebarWidthsAfterToggle(page);
    expect(reduced.next).toBe(reduced.final);

    // Control: with motion allowed the same toggle animates over 200 ms.
    await prepare(page, 'no-preference');
    await expect(shellRoot(page)).not.toHaveAttribute('data-reduced-motion', 'true');
    expect((await durationsMs(shellRoot(page))).transition).toBe(200);
    const animated = await sidebarWidthsAfterToggle(page);
    expect(animated.next).not.toBe(animated.final);
  });

  for (const preference of ['reduce', 'no-preference'] as const) {
    test(`palette open motion (${preference})`, async ({ page, asUser }) => {
      await openShell(page, asUser);
      await prepare(page, preference);
      await page.getByRole('banner').getByRole('button', { name: 'Open search' }).click();
      const content = palette(page);
      const scrim = page.locator('[data-slot="dialog-overlay"]');
      if (preference === 'reduce') {
        expect(await motionMs(content)).toBeLessThanOrEqual(INSTANT_MS);
        expect(await motionMs(scrim)).toBeLessThanOrEqual(INSTANT_MS);
      } else {
        // 200 ms fade and scale (a 250 ms bottom sheet on phones).
        expect(await motionMs(content)).toBeGreaterThanOrEqual(200);
      }
    });

    test(`sheet open motion (${preference})`, async ({ page, asUser }) => {
      test.skip(layoutOf(page) !== 'phone', 'sheets are the phone layout');
      await openShell(page, asUser);
      await prepare(page, preference);
      await page.locator('[data-mobile-nav-item="more"]').click();
      const sheet = page.locator('[data-more-sheet]');
      const scrim = page.locator('[data-slot="sheet-overlay"]');
      if (preference === 'reduce') {
        expect(await motionMs(sheet)).toBeLessThanOrEqual(INSTANT_MS);
        expect(await motionMs(scrim)).toBeLessThanOrEqual(INSTANT_MS);
      } else {
        expect(await motionMs(sheet)).toBe(250);
      }
    });
  }
});
