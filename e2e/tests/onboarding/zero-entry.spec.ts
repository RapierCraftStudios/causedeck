// Zero-entry onboarding budget (#501, D-048): an advocate with identifiers at both launch High
// Courts goes identifiers, courts and live progress to the confirm grid inside 10 minutes. The
// advocate-search sources are seeded uncleared, so a cleared staging fixture decides how far the
// run gets; the budget below is asserted on the steps that run in every environment.
import { expect, test } from '../../fixtures/index.ts';
import { SHELL_WORKSPACE } from '../shell/helpers.ts';

const BUDGET_MS = 10 * 60 * 1000;

test('identifiers at both launch High Courts reach the search result within 10 minutes', async ({
  page,
  asUser,
}) => {
  const started = Date.now();
  await asUser('owner', { workspace: SHELL_WORKSPACE, path: 'onboarding' });
  await page.getByLabel('Enrolment numbers or BRN, one per line').fill('D/1234/2015');
  await page.getByRole('button', { name: 'Choose courts' }).click();
  await page.getByLabel('Madras High Court').check();
  await page.getByLabel('Karnataka High Court').check();
  await page.getByRole('button', { name: 'Search these courts' }).click();

  // The run ends on the confirm grid, the disambiguation step or the nothing-found notice; none of
  // them saves anything before the member confirms.
  await expect(
    page
      .getByRole('status')
      .or(page.getByRole('heading', { name: 'Is this you?' }))
      .first(),
  ).toBeVisible({ timeout: BUDGET_MS });
  expect(Date.now() - started).toBeLessThan(BUDGET_MS);
});
