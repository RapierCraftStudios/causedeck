// App-shell polish (#183) at the founder's review widths, 390 px (phone) and 1440 px (desktop):
// screenshots of Today, Matters, the command palette and the shortcuts dialog for the PR, plus the
// geometry checks behind them: the Capture label clears its circle, the palette's list focus ring
// stays inside the clipped dialog, and the shortcuts list's focus line is a light 1 px.
import type { Locator, Page, TestInfo } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';

import { openShell, palette } from './helpers.ts';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const WIDTHS = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '1440', viewport: { width: 1440, height: 900 } },
] as const;

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** Keyboard-focus `locator`: focus-visible applies after a key press. */
async function keyboardFocus(page: Page, locator: Locator) {
  await page.keyboard.press('Shift');
  await locator.evaluate((element) => {
    const target = element as HTMLElement;
    target.focus();
    // A scroller only becomes focusable while its content overflows: make sure it can take focus.
    if (document.activeElement !== target) {
      target.tabIndex = -1;
      target.focus();
    }
  });
}

/** The element's computed outline. Poll it: focus styles can land a frame or two after focus. */
function outlineOf(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(':focus-visible'),
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      offset: Number.parseFloat(style.outlineOffset),
    };
  });
}

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('no bounding box');
  return rect;
};

// One project is enough: each test sets its own viewport.
test.beforeEach(({ browserName }, testInfo) => {
  test.skip(
    browserName !== 'chromium' || testInfo.project.name !== 'chromium-1280-light',
    'runs once, in chromium-1280-light',
  );
});

for (const { name, viewport } of WIDTHS) {
  test.describe(`at ${name} px`, () => {
    test.use({ viewport });

    test('Today and Matters', async ({ page, asUser }, testInfo) => {
      await openShell(page, asUser);
      await expect(page.locator('[data-route="today"] [data-pattern-state="empty"]')).toBeVisible();
      await shot(page, testInfo, `${name}-today`);
      await openShell(page, asUser, { path: 'matters' });
      await expect(page.locator('[data-route="matters"] [data-empty-action]')).toBeVisible();
      await shot(page, testInfo, `${name}-matters`);
    });

    test('command palette', async ({ page, asUser }, testInfo) => {
      await openShell(page, asUser);
      await page.keyboard.press(`${MOD}+k`);
      const dialog = palette(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('option').first()).toBeVisible();

      // The list's 2 px focus ring is drawn inside it (offset -2 px), so the overflow-hidden dialog
      // cannot clip it.
      const list = dialog.locator('[data-slot="command-list"]');
      await keyboardFocus(page, list);
      await expect
        .poll(() => outlineOf(list))
        .toEqual({ focusVisible: true, style: 'solid', width: 2, offset: -2 });
      const [listBox, dialogBox] = [await box(list), await box(dialog)];
      expect(listBox.x).toBeGreaterThanOrEqual(dialogBox.x);
      expect(listBox.x + listBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 0.5);

      await shot(page, testInfo, `${name}-command-palette`);
    });

    test('shortcuts dialog', async ({ page, asUser }, testInfo) => {
      await openShell(page, asUser);
      await page.keyboard.press('?');
      const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await expect(dialog).toBeVisible();

      // A light 1 px inset line in the ring token, not a 2 px outer outline.
      const list = dialog.locator('[data-slot="shortcuts-list"]');
      await keyboardFocus(page, list);
      await expect
        .poll(() => outlineOf(list))
        .toEqual({ focusVisible: true, style: 'solid', width: 1, offset: -1 });

      await shot(page, testInfo, `${name}-shortcuts-dialog`);
    });
  });
}

test.describe('at 390 px', () => {
  test.use({ viewport: WIDTHS[0].viewport });

  test('the Capture label does not overlap its circle', async ({ page, asUser }) => {
    await openShell(page, asUser);
    const nav = page.getByRole('navigation', { name: 'Bottom navigation' });
    const circle = await box(nav.locator('[data-capture-circle]'));
    const label = await box(nav.locator('[data-capture-label]'));
    const bar = await box(nav);
    // The circle still rises above the bar, and ends above the label.
    expect(circle.y).toBeLessThan(bar.y);
    expect(circle.y + circle.height).toBeLessThanOrEqual(label.y);
    // The label stays inside the bar.
    expect(label.y + label.height).toBeLessThanOrEqual(bar.y + bar.height);
  });
});
