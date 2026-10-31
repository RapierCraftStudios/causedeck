// Create a workspace (#179, #92): `/onboarding` is the path chooser (solo or chamber); the first
// step of either path names the workspace, and creating it makes the creator its owner and opens the
// next step of the wizard (`?w=<slug>` carries the workspace, so a refresh resumes).
import { expect, test } from '../../fixtures/index.ts';
import { shellReady, switcherList, switcherTrigger } from '../shell/helpers.ts';

test.describe('create workspace', () => {
  test('signed out, /onboarding goes to sign-in with `next`', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fonboarding$/);
  });

  test('an empty name shows an inline error and creates nothing', async ({ page, asUser }) => {
    await asUser('owner');
    await page.goto('/onboarding');
    await expect(
      page.getByRole('heading', { level: 1, name: 'How do you practise?' }),
    ).toBeVisible();
    await page.getByRole('link', { name: /Set up as a solo advocate/ }).click();
    await expect(page).toHaveURL(/\/onboarding\/solo\/workspace$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Name your workspace' }),
    ).toBeVisible();
    // Before anything is typed, the step says where data lives.
    await expect(page.getByText(/Your data is stored in India/)).toBeVisible();

    await page.getByRole('button', { name: 'Create workspace' }).click();
    const name = page.getByRole('textbox', { name: /Workspace name/ });
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Enter a name for the workspace.')).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding\/solo\/workspace$/);
  });

  test('creates a chamber, opens its invite step and lists it as Owner', async ({
    page,
    asUser,
  }) => {
    await asUser('viewer');
    await page.goto('/onboarding/chamber/workspace');
    await page.getByRole('textbox', { name: /Workspace name/ }).fill('Mylapore Chambers');
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await expect(page).toHaveURL(/\/onboarding\/chamber\/invite\?w=mylapore-chambers$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Invite your chamber' }),
    ).toBeVisible();

    await page.goto('/w/mylapore-chambers/today');
    await expect(page.locator('main')).toHaveAttribute('data-workspace-slug', 'mylapore-chambers');
    await shellReady(page);
    await switcherTrigger(page).click();
    const created = switcherList(page).locator('[data-slug="mylapore-chambers"]');
    await expect(created).toBeVisible();
    await expect(created.locator('[data-role]')).toHaveText('Owner');
    // The viewer's existing workspace is still there.
    await expect(switcherList(page).locator('[data-slug="chennai-solo"]')).toBeVisible();
  });

  test('the switcher Create workspace action opens /onboarding', async ({ page, asUser }) => {
    await asUser('owner');
    await shellReady(page);
    await switcherTrigger(page).click();
    await page.getByRole('link', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'How do you practise?' }),
    ).toBeVisible();
  });
});
