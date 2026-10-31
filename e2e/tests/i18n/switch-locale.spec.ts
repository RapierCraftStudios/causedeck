// Locale switcher and resolution (#175). Order: the signed-in user's `user.locale` > the
// `NEXT_LOCALE` cookie > `Accept-Language` > `en`. Switching saves to the user record when signed in
// and to the cookie otherwise, re-renders in place (no full reload: client state survives), sets
// `<html lang>` and toasts in the new language. The Tamil and Kannada faces are only requested on
// ta/kn pages. `@a11y` tests end with the switcher open, so the fixture runs axe on it.
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';
import { layoutOf, shellReady } from '../shell/helpers.ts';

const LABELS = { en: 'English', ta: 'தமிழ்', kn: 'ಕನ್ನಡ' } as const;

/** `locale.updated` in each catalog (packages/i18n/src/messages/<locale>/common.json). */
const UPDATED = {
  en: 'Language updated',
  ta: 'மொழி புதுப்பிக்கப்பட்டது',
  kn: 'ಭಾಷೆ ನವೀಕರಿಸಲಾಗಿದೆ',
} as const;

/** `auth.signIn.title` per locale, to prove the page content re-rendered. */
function signInTitle(locale: keyof typeof LABELS): string {
  const file = new URL(`../../../packages/i18n/src/messages/${locale}/auth.json`, import.meta.url);
  const catalog = JSON.parse(readFileSync(file, 'utf8')) as {
    auth: { signIn: { title: string } };
  };
  return catalog.auth.signIn.title;
}

/** Every font file the page requests, by URL. */
function trackFonts(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') urls.push(request.url());
  });
  return urls;
}

/** The `@font-face` file URLs of the Tamil and Kannada faces (next/font family names). */
async function indicFontUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const urls: string[] = [];
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue('font-family').replace(/['"]/g, '');
        if (!/^noto(Tamil|Kannada)$/.test(family)) continue;
        const src = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'));
        // `url()` in a stylesheet is relative to the stylesheet, not the document.
        if (src?.[1]) urls.push(new URL(src[1], sheet.href ?? document.baseURI).href);
      }
    }
    return urls;
  });
}

/** Marks the document, so a full reload (a new document) is detectable. */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
}

async function stillSameDocument(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);
}

async function localeCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === 'NEXT_LOCALE')?.value;
}

/** A switch waits on a server action and an RSC refresh; allow for a loaded CI machine. */
const SWITCHED = { timeout: 15_000 };

const globe = (page: Page) => page.locator('[data-locale-switcher="compact"] > button');

test.describe('locale resolution and switcher', () => {
  test('signed out: the sign-in globe switches by keyboard, writes the cookie, keeps page state', async ({
    page,
  }) => {
    const fonts = trackFonts(page);
    await page.goto('/sign-in');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(globe(page)).toHaveAccessibleName('Language: English');

    // No Tamil/Kannada font request on an `en` page.
    await page.evaluate(() => document.fonts.ready);
    const indic = await indicFontUrls(page);
    expect(indic).toHaveLength(2);
    expect(fonts.filter((url) => indic.includes(url))).toEqual([]);

    // Unrelated client state that a full reload would lose.
    const email = page.getByRole('textbox').first();
    await email.fill('asha@example.com');
    await markDocument(page);

    await globe(page).focus();
    await page.keyboard.press('Enter');
    const english = page.getByRole('radio', { name: LABELS.en });
    await expect(english).toBeFocused();
    await expect(english).toBeChecked();
    // Native radios: the arrow key moves the choice to the next language, தமிழ்.
    await page.keyboard.press('ArrowDown');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ta', SWITCHED);
    await expect(page.getByText(UPDATED.ta)).toBeVisible(SWITCHED);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(signInTitle('ta'));
    expect(await localeCookie(page)).toBe('ta');
    expect(await stillSameDocument(page)).toBe(true);
    await expect(email).toHaveValue('asha@example.com');
    await expect(page.getByRole('radio', { name: LABELS.ta })).toBeChecked();

    // Escape closes the list and returns focus to the globe, now naming Tamil.
    await page.keyboard.press('Escape');
    await expect(globe(page)).toBeFocused();
    await expect(globe(page)).toContainText(LABELS.ta);

    // The cookie carries the choice to the next visit, and the Tamil face loads for it.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => fonts.some((url) => indic.includes(url))).toBe(true);
  });

  test('signed in: the user setting is saved to the account and outranks the cookie', async ({
    page,
    asUser,
  }) => {
    await asUser('owner');
    await shellReady(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await markDocument(page);

    if (layoutOf(page) === 'phone') {
      await page.getByRole('button', { name: 'More' }).click();
      const sheet = page.getByRole('dialog');
      const group = sheet.getByRole('group', { name: 'Language' });
      await expect(group.getByRole('radio', { name: LABELS.en })).toBeChecked();
      await group.getByRole('radio', { name: LABELS.kn }).check();
    } else {
      await page.getByRole('button', { name: /^Account menu:/ }).click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitemradio', { name: LABELS.en })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await menu.getByRole('menuitemradio', { name: LABELS.kn }).click();
    }

    await expect(page.locator('html')).toHaveAttribute('lang', 'kn', SWITCHED);
    await expect(page.getByText(UPDATED.kn)).toBeVisible(SWITCHED);
    expect(await stillSameDocument(page)).toBe(true);
    expect(await localeCookie(page)).toBe('kn');

    // A stale `en` cookie no longer wins: `user.locale` (now kn) comes first.
    const url = new URL(page.url());
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: 'en', domain: url.hostname, path: '/' }]);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'kn');
  });

  test.describe('Accept-Language', () => {
    test.use({ locale: 'ta-IN', extraHTTPHeaders: { 'accept-language': 'ta-IN,ta;q=0.9' } });

    test('picks the locale when there is no cookie or user setting', async ({ page }) => {
      await page.context().clearCookies();
      await page.goto('/sign-in');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
      expect(await localeCookie(page)).toBe('ta');
    });
  });
});

test.describe('locale switcher accessibility', { tag: '@a11y' }, () => {
  // As in tests/a11y/public-pages.spec.ts: the sign-in editorial pane's numerals are an
  // `aria-hidden` texture that WCAG 1.4.3 exempts from contrast.
  test.use({ a11yOptions: { exclude: ['aside ol[aria-hidden="true"]'] } });

  test('sign-in globe open: options labelled in their own script', async ({ page }) => {
    await page.goto('/sign-in');
    await globe(page).click();
    for (const [lang, label] of Object.entries(LABELS)) {
      const radio = page.getByRole('radio', { name: label });
      await expect(radio).toBeVisible();
      await expect(page.locator(`label[lang="${lang}"]`)).toContainText(label);
    }
  });

  test('shell switcher open', async ({ page, asUser }) => {
    await asUser('owner');
    await shellReady(page);
    if (layoutOf(page) === 'phone') {
      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('group', { name: 'Language' })).toBeVisible();
    } else {
      await page.getByRole('button', { name: /^Account menu:/ }).focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      // Keyboard: End reaches the last item (Sign out, enabled since #1076), ArrowUp ಕನ್ನಡ,
      // ArrowUp again தமிழ்.
      await page.keyboard.press('End');
      await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(menu.locator('[data-locale-option="kn"]')).toBeFocused();
      await page.keyboard.press('ArrowUp');
      const tamil = menu.locator('[data-locale-option="ta"]');
      await expect(tamil).toBeFocused();
      await expect(tamil).toHaveAttribute('lang', 'ta');
    }
  });
});
