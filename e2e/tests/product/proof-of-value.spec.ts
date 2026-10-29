// Proof of value (#86): the privacy card (opt-out, own answers, owner download) and the owner's
// context test, by keyboard; `@a11y` runs axe (zero serious or critical) in both themes.
// The preparedness tap (after a confirmed outcome) and the weekly pulse card (on Today) are driven
// here too: tap, skip, save, dismiss, error with retry, offline, keyboard only, and axe on each state.
// The pulse is due from Monday 06:00 IST on the server clock, so its tests skip in that early window.
// Runs in CI only.
import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { expect, test } from '../../fixtures/index.ts';
import { contentReady, shellReady } from '../shell/helpers.ts';

import { openOutcome, seedHearing } from './outcome-helpers.ts';

const TAP_TITLE = 'How prepared did you feel?';
const PULSE_TITLE = 'This week';
const PULSE_FIRST = 'How mentally demanding was your work?';
const PULSE_ITEMS = [
  PULSE_FIRST,
  'How much did you worry about forgetting something?',
  'How much effort did preparing take?',
];

/** Confirms a manual outcome (no proposals), which is what makes the preparedness tap appear. */
async function confirmOutcome(page: Page, asUser: AsUser, database: string) {
  const { hearingId } = await seedHearing(database, { proposals: false });
  await openOutcome(page, asUser, hearingId);
  await page.getByLabel('What happened').fill('Adjourned, reply to be filed');
  await page.getByRole('button', { name: 'No next date / disposed' }).click();
  await page.getByRole('button', { name: 'Confirm outcome' }).click();
  await expect(page.getByText('Outcome confirmed').first()).toBeVisible();
  return { hearingId, tap: tapRegion(page) };
}

function tapRegion(page: Page) {
  return page.getByRole('region', { name: TAP_TITLE }).filter({ visible: true });
}

function pulseRegion(page: Page) {
  return page.getByRole('region', { name: PULSE_TITLE }).filter({ visible: true });
}

/** The weekly pulse opens Monday 06:00 IST on the server clock; before that it is not shown. */
function pulseWindowClosed(): boolean {
  const ist = new Date(Date.now() + 330 * 60 * 1000);
  return ist.getUTCDay() === 1 && ist.getUTCHours() < 6;
}

async function openToday(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'today' });
  await contentReady(page);
  await expect(pulseRegion(page)).toBeVisible();
}

/** Server actions are POSTs carrying a `next-action` header; abort them to force the error state. */
async function failServerActions(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action'] !== undefined) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function openPrivacy(page: Page, asUser: AsUser) {
  await asUser('owner', { path: 'settings/privacy' });
  await expect(page.getByRole('heading', { level: 2, name: 'Proof of value' })).toBeVisible();
  await shellReady(page);
}

test.describe('proof of value', () => {
  test(
    'the opt-out toggle works by keyboard and says prompts are off',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openPrivacy(page, asUser);
      const toggle = page.getByRole('checkbox', {
        name: 'Ask me preparedness and weekly questions',
      });
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(page.getByText('Prompts are off. Nothing will ask you.')).toBeVisible();
    },
  );

  test('the owner runs the context test', { tag: '@a11y' }, async ({ page, asUser }) => {
    await openPrivacy(page, asUser);
    await expect(page.getByRole('heading', { name: 'Context test' })).toBeVisible();
    const start = page.getByRole('button', { name: 'Start the test' });
    if (await start.isVisible()) {
      await start.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByText('Timer started.')).toBeAttached();
    } else {
      await expect(page.getByText('No matters to test on yet.')).toBeVisible();
    }
  });

  test('the owner downloads the pilot report by keyboard', async ({ page, asUser }) => {
    await openPrivacy(page, asUser);
    const download = page.waitForEvent('download');
    const button = page.getByRole('button', { name: 'Download the pilot report' });
    await button.focus();
    await page.keyboard.press('Enter');
    expect((await download).suggestedFilename()).toBe('proof-of-value.csv');
  });
});

test.describe('preparedness tap', () => {
  test('appears after a confirmed outcome and a tap stores the rating', async ({
    page,
    asUser,
    db,
  }) => {
    const { tap } = await confirmOutcome(page, asUser, db.name);
    await expect(tap).toBeVisible();
    // The tap mounts only once the outcome is confirmed, so it never stood in confirmation's way.
    await expect(page.getByText('Outcome confirmed').first()).toBeVisible();
    await tap.getByRole('radio', { name: '4 of 5' }).click();
    await expect(tap.getByRole('status')).toHaveText(
      'Thanks, saved. Tap another number to change it.',
    );
    await expect(tap.getByRole('radio', { name: '4 of 5' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('skipping is allowed and says it was skipped', async ({ page, asUser, db }) => {
    const { tap } = await confirmOutcome(page, asUser, db.name);
    await tap.getByRole('button', { name: 'Skip' }).click();
    await expect(tap.getByRole('status')).toHaveText(
      'Skipped. You can still tap a number to rate.',
    );
    // Skipped is not final: a later tap still rates.
    await tap.getByRole('radio', { name: '2 of 5' }).click();
    await expect(tap.getByRole('status')).toContainText('Thanks, saved.');
  });

  test('keyboard only: a digit rates and S skips', async ({ page, asUser, db }) => {
    const { tap } = await confirmOutcome(page, asUser, db.name);
    const first = tap.getByRole('radio', { name: '1 of 5' });
    // The scale's key handler attaches when it hydrates, which can trail the streamed markup.
    await expect(async () => {
      await first.focus();
      await page.keyboard.press('3');
      await expect(tap.getByRole('status')).toContainText('Thanks, saved.', { timeout: 1_000 });
    }).toPass();
    await expect(tap.getByRole('radio', { name: '3 of 5' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await tap.getByRole('radio', { name: '3 of 5' }).focus();
    await page.keyboard.press('s');
    await expect(tap.getByRole('status')).toContainText('Skipped.');
  });

  test('a failed save shows the error and Try again recovers', async ({ page, asUser, db }) => {
    const { tap } = await confirmOutcome(page, asUser, db.name);
    await failServerActions(page);
    await tap.getByRole('radio', { name: '5 of 5' }).click();
    await expect(tap.getByRole('status')).toHaveText('Could not save your rating.');
    await page.unroute('**/*');
    await tap.getByRole('button', { name: 'Try again' }).click();
    await expect(tap.getByRole('status')).toContainText('Thanks, saved.');
  });

  test('offline keeps the choice on the device', async ({ page, asUser, db, context }) => {
    const { tap } = await confirmOutcome(page, asUser, db.name);
    await context.setOffline(true);
    await tap.getByRole('radio', { name: '4 of 5' }).click();
    await expect(tap.getByRole('status')).toContainText('You are offline.');
  });
});

test.describe('proof of value accessibility', { tag: '@a11y' }, () => {
  test('the preparedness tap: default, saved and skipped have no axe violations', async ({
    page,
    asUser,
    db,
    a11y,
  }) => {
    const { tap } = await confirmOutcome(page, asUser, db.name);
    await expect(tap).toBeVisible();
    await a11y.expectNoViolations(page);
    await tap.getByRole('radio', { name: '4 of 5' }).click();
    await expect(tap.getByRole('status')).toContainText('Thanks, saved.');
    await a11y.expectNoViolations(page);
    await tap.getByRole('button', { name: 'Skip' }).click();
    await expect(tap.getByRole('status')).toContainText('Skipped.');
  });

  test('the pulse card: default, saved has no axe violations', async ({ page, asUser, a11y }) => {
    test.skip(pulseWindowClosed(), 'The weekly pulse is not due before Monday 06:00 IST.');
    await openToday(page, asUser);
    await a11y.expectNoViolations(page);
    const card = pulseRegion(page);
    for (const item of PULSE_ITEMS) {
      await card
        .getByRole('radiogroup', { name: item })
        .getByRole('radio', { name: '3 of 5' })
        .click();
    }
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Thanks, saved for this week.' })
        .filter({ visible: true }),
    ).toBeVisible();
    await a11y.expectNoViolations(page);
  });
});

test.describe('weekly pulse card', () => {
  test.skip(pulseWindowClosed(), 'The weekly pulse is not due before Monday 06:00 IST.');

  test('Save stays disabled until all three are answered, then saves', async ({ page, asUser }) => {
    await openToday(page, asUser);
    const card = pulseRegion(page);
    const save = card.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    for (const item of PULSE_ITEMS) {
      await card
        .getByRole('radiogroup', { name: item })
        .getByRole('radio', { name: '2 of 5' })
        .click();
    }
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Thanks, saved for this week.' })
        .filter({ visible: true }),
    ).toBeVisible();
  });

  test('Not now dismisses it for the week', async ({ page, asUser }) => {
    await openToday(page, asUser);
    await pulseRegion(page).getByRole('button', { name: 'Not now' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Dismissed until next week.' })
        .filter({ visible: true }),
    ).toBeVisible();
    // A dismissal is a row: the card does not come back on reload.
    await page.reload();
    await contentReady(page);
    await expect(pulseRegion(page)).toHaveCount(0);
  });

  test('keyboard only: digits answer each item, Enter saves', async ({ page, asUser }) => {
    await openToday(page, asUser);
    const card = pulseRegion(page);
    await expect(async () => {
      await card
        .getByRole('radiogroup', { name: PULSE_FIRST })
        .getByRole('radio', { name: '1 of 5' })
        .focus();
      await page.keyboard.press('4');
      await expect(
        card.getByRole('radiogroup', { name: PULSE_FIRST }).getByRole('radio', { name: '4 of 5' }),
      ).toHaveAttribute('aria-checked', 'true', { timeout: 1_000 });
    }).toPass();
    for (const item of PULSE_ITEMS.slice(1)) {
      await card
        .getByRole('radiogroup', { name: item })
        .getByRole('radio', { name: '1 of 5' })
        .focus();
      await page.keyboard.press('2');
    }
    const save = card.getByRole('button', { name: 'Save' });
    await expect(save).toBeEnabled();
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Thanks, saved for this week.' })
        .filter({ visible: true }),
    ).toBeVisible();
  });

  test('keyboard only: Escape dismisses', async ({ page, asUser }) => {
    await openToday(page, asUser);
    const card = pulseRegion(page);
    await expect(async () => {
      await card
        .getByRole('radiogroup', { name: PULSE_FIRST })
        .getByRole('radio', { name: '1 of 5' })
        .focus();
      await page.keyboard.press('Escape');
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'Dismissed until next week.' })
          .filter({ visible: true }),
      ).toBeVisible({ timeout: 1_000 });
    }).toPass();
  });

  test('a failed save shows the error and Try again recovers', async ({ page, asUser }) => {
    await openToday(page, asUser);
    const card = pulseRegion(page);
    for (const item of PULSE_ITEMS) {
      await card
        .getByRole('radiogroup', { name: item })
        .getByRole('radio', { name: '5 of 5' })
        .click();
    }
    await failServerActions(page);
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByRole('status')).toHaveText('Could not save. Try again.');
    await page.unroute('**/*');
    await card.getByRole('button', { name: 'Try again' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Thanks, saved for this week.' })
        .filter({ visible: true }),
    ).toBeVisible();
  });

  test('offline shows the offline message', async ({ page, asUser, context }) => {
    await openToday(page, asUser);
    const card = pulseRegion(page);
    for (const item of PULSE_ITEMS) {
      await card
        .getByRole('radiogroup', { name: item })
        .getByRole('radio', { name: '3 of 5' })
        .click();
    }
    await context.setOffline(true);
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByRole('status')).toContainText('You are offline.');
  });
});
