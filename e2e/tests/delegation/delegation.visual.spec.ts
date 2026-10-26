// Tomorrow plan visual baselines (#63): light and dark at 360/768/1280 via the viewport and theme
// projects. `*.visual.spec.ts` is not run in the blocking ship scope (playwright.config.ts
// testIgnore); baselines are generated only by the e2e workflow's `update_snapshots` dispatch.
import { existsSync } from 'node:fs';

import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { COURTS_WORKSPACE } from '../../fixtures/courts-data.ts';
import { shellReady } from '../shell/helpers.ts';

const open = async (page: Page, asUser: AsUser) => {
  await asUser('owner', { workspace: COURTS_WORKSPACE, path: 'tomorrow' });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
};

test.describe('tomorrow plan visual', { tag: '@visual' }, () => {
  test('plan', async ({ page, asUser }, testInfo) => {
    test.skip(
      testInfo.config.updateSnapshots === 'none' &&
        !existsSync(testInfo.snapshotPath('tomorrow-plan.png', { kind: 'screenshot' })),
      'no baseline yet: dispatch the e2e workflow with update_snapshots',
    );
    await open(page, asUser);
    await expect(page).toHaveScreenshot('tomorrow-plan.png', { fullPage: true });
  });
});
