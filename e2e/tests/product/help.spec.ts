// Help journeys (#94): the `?` shortcut sheet, article search (English, tag filter, empty state),
// contextual tips, coachmark dismissal, the Contact tab and its states. CI only; `@a11y` runs axe
// with zero serious violations. Fictional data only.
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

const TODAY = (slug: string) => `/w/${slug}/today`;

test.describe('help', () => {
  test(
    '? opens the shortcut sheet as a labelled table',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await asUser('owner', { path: TODAY('shell') });
      await contentReady(page);
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog')).toBeVisible();
      // Left open, so the automatic axe run after the test covers the sheet (1280 light and dark
      // in the full matrix; both schemes are also checked explicitly below).
      await page.getByRole('tab', { name: /shortcuts/i }).click();
      await expect(page.getByRole('table')).toBeVisible();
    },
  );

  test('Escape closes the sheet', async ({ page, asUser }) => {
    await asUser('owner', { path: TODAY('shell') });
    await contentReady(page);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    for (const tab of ['articles', 'shortcuts', 'contact'] as const) {
      test(
        `help sheet ${tab} tab has no axe violations in ${scheme}`,
        { tag: '@a11y' },
        async ({ page, asUser }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await asUser('owner', { path: TODAY('shell') });
          await contentReady(page);
          await page.keyboard.press('?');
          const sheet = page.getByRole('dialog');
          await expect(sheet).toBeVisible();
          await page.getByRole('tab', { name: new RegExp(tab, 'i') }).click();
          if (tab === 'shortcuts') {
            await expect(sheet.getByRole('table')).toHaveAccessibleName(/.+/);
          }
        },
      );
    }
  }

  test(
    'the help page has no axe violations in dark',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await asUser('owner', { path: '/w/shell/help' });
      await contentReady(page);
      await expect(page.getByRole('searchbox')).toBeVisible();
    },
  );

  test.describe('gestures guide on a touch screen', () => {
    test.beforeEach(async ({ page }) => {
      // Force `(pointer: coarse)` so the guide shows on any project, desktop Chromium included.
      await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query: string) => {
          if (!query.includes('pointer: coarse')) return original(query);
          return {
            matches: true,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => false,
          } as MediaQueryList;
        };
      });
    });

    test('replaces the key table with the gestures list', async ({ page, asUser }) => {
      await asUser('owner', { path: TODAY('shell') });
      await contentReady(page);
      await page.keyboard.press('?');
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      await page.getByRole('tab', { name: /shortcuts/i }).click();
      await expect(sheet.getByRole('heading', { name: 'Gestures' })).toBeVisible();
      await expect(sheet.getByRole('listitem')).toHaveCount(4);
      await expect(sheet.getByText('Pull a list down to refresh it.')).toBeVisible();
      await expect(sheet.getByRole('table')).toHaveCount(0);
    });

    test(
      'gestures guide has no axe violations in dark',
      { tag: '@a11y' },
      async ({ page, asUser }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await asUser('owner', { path: TODAY('shell') });
        await contentReady(page);
        await page.keyboard.press('?');
        await page.getByRole('tab', { name: /shortcuts/i }).click();
        await expect(page.getByRole('heading', { name: 'Gestures' })).toBeVisible();
      },
    );
  });

  test('the help page searches articles and shows the empty state', async ({ page, asUser }) => {
    await asUser('owner', { path: '/w/shell/help' });
    await contentReady(page);
    await page.getByRole('searchbox').fill('undo');
    await expect(page.getByRole('button', { name: 'Proposals and undo' })).toBeVisible();
    await page.getByRole('searchbox').fill('zzzzqx');
    await expect(page.getByText(/no articles/i)).toBeVisible();
  });

  test('a contextual tip opens the matching article without leaving the page', async ({
    page,
    asUser,
  }) => {
    await asUser('owner', { path: TODAY('shell') });
    await contentReady(page);
    await page.getByRole('button', { name: /help/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/today$/);
  });

  test('the coachmark closes with Escape and stays closed', async ({ page, asUser }) => {
    await asUser('owner', { path: TODAY('shell') });
    await contentReady(page);
    const note = page.getByRole('complementary');
    await expect(note.first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await contentReady(page);
    await expect(page.getByRole('complementary')).toHaveCount(0);
  });

  test('the Contact tab shows a way to reach support', async ({ page, asUser }) => {
    await asUser('owner', { path: TODAY('shell') });
    await contentReady(page);
    await page.keyboard.press('?');
    await page.getByRole('tab', { name: /contact/i }).click();
    await expect(page.getByRole('link', { name: /whatsapp|support@/i })).toBeVisible();
  });
});
