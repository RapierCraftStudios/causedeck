// Hearing outcome visual baselines (#62): default, needs-you and empty at 360, 768 and 1280 px in
// light and dark (the viewport and theme projects). Baselines are generated and compared in CI.
import { expect, test } from '../../fixtures/index.ts';

import { openOutcome, seedHearing } from './outcome-helpers.ts';

test.describe('hearing outcome visual', { tag: '@visual' }, () => {
  test('with proposals', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId);
    await expect(page).toHaveScreenshot('outcome-proposals.png', { fullPage: true });
  });

  test('manual', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: false });
    await openOutcome(page, asUser, hearingId);
    await expect(page).toHaveScreenshot('outcome-manual.png', { fullPage: true });
  });
});
