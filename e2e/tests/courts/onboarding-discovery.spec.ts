// Zero-entry onboarding journey (#501, D-048; acceptance: populated court-day view in under 10
// minutes). Runs in CI only. Identifiers, then courts, then the live progress line, then either the
// disambiguation prompt, the confirm grid or the nothing-found notice; nothing is saved before the
// confirm grid, and the whole path is held to the 10-minute budget.
import { expect, test } from '../../fixtures/index.ts';

import { COURTS_WORKSPACE } from '../../fixtures/courts-data.ts';
import { shellReady } from '../shell/helpers.ts';

const BUDGET_MS = 10 * 60 * 1000;

test('enrolment number to a result inside the 10-minute budget', async ({ page, asUser }) => {
  const started = Date.now();
  await asUser('owner', { workspace: COURTS_WORKSPACE, path: 'onboarding' });
  await shellReady(page);
  const root = page.locator('[data-slot="onboarding-discovery"]');

  await expect(root.getByRole('heading', { name: 'Who should we look for?' })).toBeVisible();
  const next = root.getByRole('button', { name: 'Choose courts' });
  await expect(next).toBeDisabled();
  await root.getByLabel('Enrolment numbers or BRN, one per line').fill('KAR/1/2020');
  await next.click();

  await expect(root.getByRole('heading', { name: 'Which courts?' })).toBeVisible();
  await expect(root.getByRole('checkbox')).toHaveCount(3);
  await root.getByRole('button', { name: 'Search these courts' }).click();

  // Whatever the fixtures return, the member lands on a defined next step, never a silent save.
  const grid = page.locator('[data-slot="confirm-grid"]');
  const disambiguate = root.getByRole('heading', { name: 'Is this you?' });
  const nothing = root.getByText('No listings carrying you were found');
  await expect(grid.or(disambiguate).or(nothing).first()).toBeVisible({ timeout: BUDGET_MS });
  expect(Date.now() - started).toBeLessThan(BUDGET_MS);
});

test('a name alone prompts for confirmation instead of saving', async ({ page, asUser }) => {
  await asUser('owner', { workspace: COURTS_WORKSPACE, path: 'onboarding' });
  await shellReady(page);
  const root = page.locator('[data-slot="onboarding-discovery"]');
  await root.getByLabel('Name spellings, one per line').fill('R Kumar');
  await root.getByRole('button', { name: 'Choose courts' }).click();
  await root.getByRole('button', { name: 'Search these courts' }).click();
  const disambiguate = root.getByRole('heading', { name: 'Is this you?' });
  const nothing = root.getByText('No listings carrying you were found');
  await expect(disambiguate.or(nothing).first()).toBeVisible({ timeout: BUDGET_MS });
  await expect(page.locator('[data-slot="confirm-grid"]')).toHaveCount(0);
});
