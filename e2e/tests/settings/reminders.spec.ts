// Court-day reminder preferences (#64; PRD EX-5): the card on `/w/<slug>/settings/notifications`
// renders its rows, saves a channel switch from the keyboard and keeps it after a reload.
// `@a11y` runs axe on the page the test ends on (see e2e/README.md). Runs in CI only.
import { expect, test } from '../../fixtures/index.ts';
import { SHELL_WORKSPACE, shellReady } from '../shell/helpers.ts';

const CARD = 'Court-day reminders';

test.describe('court-day reminders settings', { tag: '@a11y' }, () => {
  test('shows the three reminders and saves a channel from the keyboard', async ({
    page,
    asUser,
  }) => {
    await asUser('owner', { path: 'settings/notifications' });
    await shellReady(page);
    await expect(page.getByRole('heading', { name: CARD })).toBeVisible();
    for (const label of ['Evening brief', 'Morning changes', 'Outcome missing']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    const push = page.getByRole('switch', { name: 'Evening brief: Push' });
    const before = await push.getAttribute('aria-checked');
    await push.focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(push).not.toHaveAttribute('aria-checked', before ?? '');

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/w/${SHELL_WORKSPACE}/settings/notifications`));
    await expect(page.getByRole('switch', { name: 'Evening brief: Push' })).not.toHaveAttribute(
      'aria-checked',
      before ?? '',
    );
  });
});
