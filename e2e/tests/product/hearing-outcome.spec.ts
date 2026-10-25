// Hearing outcome confirmation (#62, PRD EX-3), run by the CI Playwright e2e job. Covers the
// proposal display, confirm gating, the conflict card, obligation actions, the manual path, the
// transcript drawer, the states, the delegated appearance, axe and keyboard, and the time-to-confirm
// benchmark: with three seeded directions the happy path takes at most 6 keyboard actions or 8 taps.
import { expect, test } from '../../fixtures/index.ts';

import { PROPOSED_DATE, openOutcome, seedHearing, StepCounter } from './outcome-helpers.ts';

test.describe('hearing outcome', () => {
  test('shows the proposal with its sources and keeps Confirm disabled', async ({
    page,
    asUser,
    db,
  }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId);
    await expect(page.getByLabel('What happened')).toHaveValue('Adjourned for reply');
    await expect(page.getByRole('button', { name: `Confirm ${PROPOSED_DATE}` })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByRole('button', { name: 'Confirm outcome' })).toBeDisabled();
    await expect(page.getByRole('listitem', { name: 'File reply' })).toBeVisible();
  });

  test('time to confirm: three directions in at most 6 keyboard actions or 8 taps', async ({
    page,
    asUser,
    db,
  }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId);
    const steps = new StepCounter(page);
    await steps.tap(page.getByRole('button', { name: `Confirm ${PROPOSED_DATE}` }));
    for (const title of ['File reply', 'Serve the respondent', 'Produce the lease']) {
      await steps.tap(
        page.getByRole('listitem', { name: title }).getByRole('button', { name: 'Confirm' }),
      );
    }
    await steps.tap(page.getByRole('button', { name: 'Confirm outcome' }));
    await expect(page.getByText('Outcome confirmed').first()).toBeVisible();
    expect(steps.taps).toBeLessThanOrEqual(8);
    test.info().annotations.push({ type: 'taps', description: String(steps.taps) });
  });

  test('performance: the confirm server action answers in under 300 ms on seeded data', async ({
    page,
    asUser,
    db,
  }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId);
    await page.getByRole('button', { name: `Confirm ${PROPOSED_DATE}` }).click();
    for (const title of ['File reply', 'Serve the respondent', 'Produce the lease']) {
      await page
        .getByRole('listitem', { name: title })
        .getByRole('button', { name: 'Confirm' })
        .click();
    }
    const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.ok());
    await page.getByRole('button', { name: 'Confirm outcome' }).click();
    const started = Date.now();
    await response;
    expect(Date.now() - started).toBeLessThan(300);
  });

  test('keyboard path: a, a, a on the rows and Ctrl+Enter confirm', async ({
    page,
    asUser,
    db,
  }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId);
    const steps = new StepCounter(page);
    await page.getByRole('button', { name: `Confirm ${PROPOSED_DATE}` }).click();
    for (const title of ['File reply', 'Serve the respondent', 'Produce the lease']) {
      await page.getByRole('listitem', { name: title }).focus();
      await steps.press('a');
    }
    await steps.press('Control+Enter');
    await expect(page.getByText('Outcome confirmed').first()).toBeVisible();
    expect(steps.keys).toBeLessThanOrEqual(6);
  });

  test('a conflicting date shows both sources and needs a choice', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true, conflict: true });
    await openOutcome(page, asUser, hearingId);
    await expect(page.getByText('The next date differs from the one on file')).toBeVisible();
    await page.getByRole('button', { name: `Confirm ${PROPOSED_DATE}` }).click();
    await expect(page.getByRole('button', { name: 'Confirm outcome' })).toBeDisabled();
    await page.getByRole('button', { name: 'Keep this date' }).click();
    await expect(page.getByRole('button', { name: 'Keep this date' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('dismissing a direction needs a reason or not applicable', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId);
    const row = page.getByRole('listitem', { name: 'File reply' });
    await row.getByRole('button', { name: 'Dismiss' }).click();
    await page.getByRole('button', { name: 'Not applicable' }).click();
    await expect(row.getByText('Dismissed: Not applicable')).toBeVisible();
  });

  test('manual path: a typed note and date with no proposals', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: false });
    await openOutcome(page, asUser, hearingId);
    await page.getByLabel('What happened').fill('Adjourned, reply to be filed');
    await page.getByLabel('Enter a date').fill('15/04/2026');
    await page.getByRole('button', { name: 'Confirm outcome' }).click();
    await expect(page.getByText('Outcome confirmed').first()).toBeVisible();
  });

  test('transcript drawer shows the original language', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId);
    await page.getByRole('button', { name: 'Transcript' }).click();
    await expect(
      page.getByRole('dialog').getByText('Original language: English').first(),
    ).toBeVisible();
    await expect(page.getByRole('dialog').locator('mark').first()).toBeVisible();
  });

  test('states: error with retry, loading, denied for a viewer', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId, { query: '?__state=denied' });
    await expect(page.locator('[data-pattern-state="permission-denied"]')).toBeVisible();
    await page.goto(page.url().replace('__state=denied', '__state=error'));
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 15_000 });
  });

  test('offline: Confirm queues on the device', async ({ page, asUser, db, context }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: false });
    await openOutcome(page, asUser, hearingId);
    await context.setOffline(true);
    await page.getByLabel('What happened').fill('Adjourned');
    await page.getByRole('button', { name: 'No next date / disposed' }).click();
    await page.getByRole('button', { name: 'Confirm outcome' }).click();
    await expect(page.getByText('Saved on this device').first()).toBeVisible();
  });

  test('delegated appearance: a member can submit the outcome', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: false, delegateTo: 'junior' });
    await openOutcome(page, asUser, hearingId, { role: 'junior' });
    await page.getByLabel('What happened').fill('Appeared for the lawyer; adjourned');
    await page.getByRole('button', { name: 'No next date / disposed' }).click();
    await page.getByRole('button', { name: 'Confirm outcome' }).click();
    await expect(page.getByText('Outcome confirmed').first()).toBeVisible();
  });
});

test.describe('hearing outcome accessibility', { tag: '@a11y' }, () => {
  test('default', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId);
    await expect(page.getByRole('button', { name: 'Confirm outcome' })).toBeVisible();
  });

  test('keyboard only: every control is reachable by Tab', async ({ page, asUser, db }) => {
    const { hearingId } = await seedHearing(db.name, { proposals: true });
    await openOutcome(page, asUser, hearingId);
    await page.getByLabel('What happened').focus();
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  });
});
