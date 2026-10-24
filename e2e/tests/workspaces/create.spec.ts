// Create a workspace (#179): `/onboarding` is a single card with `Just me` / `A chamber`, a name
// and `Create workspace`; creating lands on the new workspace's Today with the creator as owner.
import { expect, test } from '../../fixtures/index.ts';
import { contentReady, shellReady, switcherList, switcherTrigger } from '../shell/helpers.ts';

test.describe('create workspace', () => {
  test('signed out, /onboarding goes to sign-in with `next`', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fonboarding$/);
  });

  test('an empty name shows an inline error and creates nothing', async ({ page, asUser }) => {
    await asUser('owner');
    await page.goto('/onboarding');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your workspace' }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Just me' })).toBeChecked();

    await page.getByRole('button', { name: 'Create workspace' }).click();
    const name = page.getByRole('textbox', { name: /Workspace name/ });
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Enter a name for the workspace.')).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('creates a chamber, lands on its Today and lists it as Owner', async ({ page, asUser }) => {
    await asUser('viewer');
    await page.goto('/onboarding');
    // Hydrated first: a click before it submits the form natively and reloads /onboarding (CI
    // flake: the URL stayed /onboarding on the first attempt).
    await contentReady(page);
    await page.getByText('A chamber').click();
    await expect(page.getByRole('radio', { name: 'A chamber' })).toBeChecked();
    await page.getByRole('textbox', { name: /Workspace name/ }).fill('Mylapore Chambers');
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await expect(page).toHaveURL(/\/w\/mylapore-chambers\/today$/);
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
      page.getByRole('heading', { level: 1, name: 'Create your workspace' }),
    ).toBeVisible();
  });
});
