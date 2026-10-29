// Keyboard chords (#11, #157): `g` then a key goes to a destination within a 1 s window, chords are
// suppressed while typing, and `?` opens the shortcuts dialog grouped by area.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';

import { openShell, palette, switcherList, switcherTrigger, SHELL_WORKSPACE } from './helpers.ts';

/** apps/web/lib/shortcuts/registry.ts `NAV_CHORDS`. */
const CHORDS = {
  t: 'today',
  i: 'inbox',
  m: 'matters',
  o: 'obligations',
  b: 'briefs',
  c: 'courts',
  a: 'activity',
  s: 'settings',
} as const;

/** `CHORD_TIMEOUT_MS` in @causedeck/ui/hooks. */
const CHORD_WINDOW_MS = 1000;

async function chord(page: Page, second: string) {
  await page.keyboard.press('g');
  await page.keyboard.press(second);
}

test.describe('keyboard chords', () => {
  for (const [key, destination] of Object.entries(CHORDS)) {
    test(`g then ${key} goes to ${destination}`, async ({ page, asUser }) => {
      // Start somewhere else so the move is visible.
      await openShell(page, asUser, { path: key === 't' ? 'matters' : 'today' });
      await chord(page, key);
      // Settings lands on its first section, the workspace profile (#284).
      const landing = destination === 'settings' ? 'settings/profile' : destination;
      await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/${landing}$`));
    });
  }

  test('the chord window closes after 1 s', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await page.keyboard.press('g');
    await page.waitForTimeout(CHORD_WINDOW_MS + 200);
    await page.keyboard.press('m');
    // Give a (wrong) navigation the chance to start before asserting it did not.
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/today$`));

    // A prompt second key still works.
    await chord(page, 'm');
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/matters$`));
  });

  for (const field of ['input', 'textarea', 'contenteditable'] as const) {
    test(`chords are suppressed while typing in ${field}`, async ({ page, asUser }) => {
      await openShell(page, asUser);
      await page.locator('main').evaluate((main, kind) => {
        const element =
          kind === 'contenteditable'
            ? Object.assign(document.createElement('div'), { contentEditable: 'true' })
            : document.createElement(kind);
        element.setAttribute('data-typing-target', '');
        element.setAttribute('aria-label', 'Typing target');
        main.prepend(element);
      }, field);
      const target = page.locator('[data-typing-target]');
      await target.focus();
      await chord(page, 'm');
      await page.keyboard.press('?');
      await page.keyboard.press('[');
      await page.waitForTimeout(300);
      await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/today$`));
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (field === 'contenteditable') await expect(target).toHaveText('gm?[');
      else await expect(target).toHaveValue('gm?[');
    });
  }

  test('chords are suppressed in the switcher and palette fields', async ({ page, asUser }) => {
    await openShell(page, asUser);
    await switcherTrigger(page).click();
    const filter = page.getByRole('combobox', { name: 'Find a workspace' });
    await expect(filter).toBeFocused();
    await chord(page, 'm');
    await expect(filter).toHaveValue('gm');
    await page.keyboard.press('Escape');
    // The popover must be gone before Ctrl+K, or the shortcut races its focus restore.
    await expect(switcherList(page)).toHaveCount(0);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const input = palette(page).getByRole('combobox');
    await expect(input).toBeFocused();
    await chord(page, 'm');
    await expect(input).toHaveValue('gm');
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/today$`));
  });

  test('`?` opens a dialog listing every shortcut, grouped by area', async ({ page, asUser }) => {
    // Not /today: the court-day board owns `?` there and opens its own, ungrouped list once its lazy
    // chunk has loaded, so the shell dialog only wins the race. Settings has no page-level `?`.
    await openShell(page, asUser, { path: 'settings/profile' });
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    for (const group of ['Navigation', 'Actions', 'Help']) {
      await expect(dialog.getByRole('region', { name: group })).toBeVisible();
    }
    const navigation = dialog.getByRole('region', { name: 'Navigation' });
    await expect(navigation.locator('[data-slot="shortcut"]')).toHaveCount(
      Object.keys(CHORDS).length,
    );
    await expect(navigation).toContainText('Go to Matters');
    const actions = dialog.getByRole('region', { name: 'Actions' });
    for (const label of ['Capture', 'Open command palette', 'Toggle sidebar', 'Search this page']) {
      await expect(actions).toContainText(label);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
