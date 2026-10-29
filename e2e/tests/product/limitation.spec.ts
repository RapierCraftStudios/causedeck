// Limitation tracker journeys (#942, part 4 of #84) on `/w/chennai-solo/limitation`: the flag is on
// and a SYNTHETIC (fictional) rule table is seeded, one rule left as an unreviewed draft. Covers the
// list and its states, proposing a date from a reviewed rule, confirming it, the permission split
// and the keyboard shortcuts of #941 (`p` proposes, `Enter` confirms the selected proposal, `Esc`
// clears the selection and closes the dialog). `@a11y` tests end on the state they name, so axe
// (zero serious or critical) runs on it in the light and dark projects. Visual baselines are in
// limitation.visual.spec.ts. Runs in CI only.
import { expect as baseExpect, test } from '../../fixtures/index.ts';
import { LIMITATION } from '../../fixtures/limitation-data.ts';

import { cards, openLimitation, route } from './limitation-helpers.ts';

// A client navigation renders a dynamic route and a server action writes to Postgres.
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe('limitation tracker', () => {
  test.describe.configure({ timeout: 90_000 });

  test(
    'lists a proposed date with its status, matter and last day to file',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await openLimitation(page, asUser, db.name);
      await expect(page.getByRole('heading', { level: 1, name: 'Limitation' })).toBeVisible();
      await expect(route(page).locator('[data-slot="limitation-gated-notice"]')).toBeVisible();
      const list = page.getByRole('list', { name: 'Limitation computations' });
      await expect(list).toBeVisible();
      await expect(cards(page)).toHaveCount(1);
      const card = cards(page).first();
      await expect(card).toContainText('Last day to file');
      await expect(card.locator('time')).toHaveAttribute(
        'datetime',
        LIMITATION.computation.expiresOn,
      );
      await expect(card).toContainText('Proposed');
      await expect(card).toContainText(LIMITATION.matter.id);
    },
  );

  test('shows the rule that produced a date in the working', async ({ page, asUser, db }) => {
    await openLimitation(page, asUser, db.name);
    const card = cards(page).first();
    await card.getByRole('button', { name: 'Show working' }).click();
    await expect(card).toContainText('How this date was computed');
    await expect(card).toContainText(LIMITATION.suit.code);
    await expect(card).toContainText(LIMITATION.version);
    await card.getByRole('button', { name: 'Hide working' }).click();
    await expect(card).not.toContainText('How this date was computed');
  });

  test('confirms a proposal with the Confirm button', async ({ page, asUser, db }) => {
    await openLimitation(page, asUser, db.name);
    const card = cards(page).first();
    await card.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(card).toContainText('Confirmed');
    await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  });

  test('proposes a date from a reviewed rule, never from the draft', async ({
    page,
    asUser,
    db,
  }) => {
    await openLimitation(page, asUser, db.name, { computation: false });
    await expect(
      route(page)
        .locator('[data-slot="empty-state-title"]')
        .filter({ hasText: 'No limitation dates yet' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Propose a date' })
      .filter({ visible: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Propose a limitation date' });
    await expect(dialog).toBeVisible();
    // Only reviewed rules are offered.
    const rule = dialog.getByLabel('Rule');
    await expect(rule.locator('option')).toHaveText([
      LIMITATION.suit.title,
      LIMITATION.appeal.title,
    ]);
    await dialog.getByLabel('Matter ID').fill(LIMITATION.matter.id);
    await dialog.getByLabel('Start date').fill('2026-01-10');
    await dialog.getByRole('button', { name: 'Compute' }).click();
    await expect(dialog).toBeHidden();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Proposed');
  });

  test('says no reviewed rule table exists when only a draft is imported', async ({
    page,
    asUser,
    db,
  }) => {
    await openLimitation(page, asUser, db.name, { reviewed: false });
    await expect(route(page).locator('[data-slot="limitation-no-rules"]')).toContainText(
      'No reviewed rule table',
    );
    await expect(
      page.getByRole('button', { name: 'Propose a date' }).filter({ visible: true }).first(),
    ).toBeDisabled();
  });

  test('a viewer sees due dates but cannot propose or confirm', async ({ page, asUser, db }) => {
    await openLimitation(page, asUser, db.name, { role: 'viewer', status: 'confirmed' });
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Propose a date' })).toHaveCount(0);
    await expect(
      cards(page).first().getByRole('button', { name: 'Confirm', exact: true }),
    ).toHaveCount(0);
    // No rule, so no working either.
    await expect(cards(page).first().getByRole('button', { name: 'Show working' })).toHaveCount(0);
  });

  test.describe('keyboard', () => {
    test('p opens the propose dialog and Esc closes it, returning focus', async ({
      page,
      asUser,
      db,
    }) => {
      await openLimitation(page, asUser, db.name);
      const dialog = page.getByRole('dialog', { name: 'Propose a limitation date' });
      // The hotkey listener attaches when the list hydrates, which can trail <main>: retry the key.
      await expect(async () => {
        await page.keyboard.press('p');
        await expect(dialog).toBeVisible({ timeout: 1_000 });
      }).toPass();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('p is ignored while typing in a field', async ({ page, asUser, db }) => {
      await openLimitation(page, asUser, db.name);
      const dialog = page.getByRole('dialog', { name: 'Propose a limitation date' });
      await expect(async () => {
        await page.keyboard.press('p');
        await expect(dialog).toBeVisible({ timeout: 1_000 });
      }).toPass();
      const matter = dialog.getByLabel('Matter ID');
      await matter.click();
      await page.keyboard.type('pp');
      await expect(matter).toHaveValue('pp');
      await expect(dialog).toBeVisible();
    });

    test('Enter confirms the selected proposal and Esc clears the selection', async ({
      page,
      asUser,
      db,
    }) => {
      await openLimitation(page, asUser, db.name);
      const card = cards(page).first();
      // Focusing a card selects it; Esc clears it.
      await expect(async () => {
        await card.focus();
        await expect(card).toHaveAttribute('data-selected', '', { timeout: 1_000 });
      }).toPass();
      await page.keyboard.press('Escape');
      await expect(card).not.toHaveAttribute('data-selected');

      // Select it again and confirm with Enter (the listener may attach after the first press).
      await expect(async () => {
        // Esc leaves focus on the card, and focusing a focused element fires no focus event.
        await card.blur();
        await card.focus();
        await page.keyboard.press('Enter');
        await expect(card).toContainText('Confirmed', { timeout: 2_000 });
      }).toPass();
    });
  });
});
