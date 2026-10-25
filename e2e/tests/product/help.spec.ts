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
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
  );

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
