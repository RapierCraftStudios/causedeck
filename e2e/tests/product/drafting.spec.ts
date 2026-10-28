// Drafting studio journeys (#829) on `/w/chennai-solo/drafts`: create from a template, save and the
// studio keys, the offline queue, reduced motion, and no send, share or file control; then (#910)
// check citations, acknowledge not-found ones and the export dialog. The e2e stack has no worker,
// so an export stays queued: the download link is not asserted. Runs in CI only.
import { DRAFTING, DRAFTING_WORKSPACE } from '../../fixtures/drafting-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

import { CITED_STUDIO, checkCitations, citationPanel, seedCitedDraft } from './drafting-helpers.ts';

const STUDIO = `drafts/${DRAFTING.draft.id}`;

test.describe('drafting studio', () => {
  test('creates a draft from a template and opens it in the studio', async ({ page, asUser }) => {
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: 'drafts' });
    await contentReady(page);
    await page.locator('[data-drafts-action="new"]').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: DRAFTING.template.name }).check();
    await dialog.getByLabel('Draft title').fill(DRAFTING.created);
    await dialog.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL(/\/drafts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('main', { name: 'Draft editor' })).toBeVisible();
  });

  test('lists the seeded draft and links to its studio', async ({ page, asUser }) => {
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: 'drafts' });
    await contentReady(page);
    await page.getByRole('link', { name: `Open draft ${DRAFTING.draft.title}` }).click();
    await expect(page).toHaveURL(new RegExp(`${DRAFTING.draft.id}$`));
  });

  test('saves with Ctrl+S, opens draft actions with Ctrl+K and closes them with Escape', async ({
    page,
    asUser,
  }) => {
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: STUDIO });
    await contentReady(page);
    // The <main> landmark carries the same name as each text area: target the text box.
    const editor = page.getByRole('textbox', { name: 'Draft editor' }).first();
    await editor.fill('Memo of appearance (edited)');
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    await page.keyboard.press('Control+k');
    const actions = page.getByRole('dialog', { name: 'Draft actions' });
    await expect(actions).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(actions).toBeHidden();
  });

  test('queues edits offline and syncs when back online', async ({ page, asUser, context }) => {
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: STUDIO });
    await contentReady(page);
    // Offline the studio shows its cached copy read-only; an unsaved edit made before the network
    // went is what the outbox queues on save.
    await page.getByRole('textbox', { name: 'Draft editor' }).first().fill('Edited before offline');
    await context.setOffline(true);
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Offline, changes queued').first()).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('All changes synced').first()).toBeVisible();
  });

  test('honours reduced motion', async ({ page, asUser }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: STUDIO });
    await contentReady(page);
    const reduced = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(reduced).toBe(true);
    await expect(page.getByRole('main', { name: 'Draft editor' })).toBeVisible();
  });

  test('offers no send, share or file control', async ({ page, asUser }) => {
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: STUDIO });
    await contentReady(page);
    await expect(page.getByRole('button', { name: /\b(send|share|file|email)\b/i })).toHaveCount(0);
  });

  test.describe('checks, acknowledgement and export', () => {
    test.beforeEach(async ({ page, asUser, db }) => {
      await seedCitedDraft(db.name);
      await page.setViewportSize({ width: 1280, height: 900 });
      await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: CITED_STUDIO });
      await contentReady(page);
    });

    test('checks citations and shows the consistency panel', async ({ page }) => {
      await expect(page.locator('[data-slot="consistency-panel"]')).toBeVisible();
      await checkCitations(page);
      await expect(
        citationPanel(page).getByText('Not found', { exact: true }).first(),
      ).toBeVisible();
      await expect(
        citationPanel(page).getByRole('button', { name: 'Acknowledge not-found citations' }),
      ).toBeVisible();
    });

    test('acknowledges not-found citations; Confirm waits for the checkbox', async ({ page }) => {
      await checkCitations(page);
      await citationPanel(page)
        .getByRole('button', { name: 'Acknowledge not-found citations' })
        .click();
      const dialog = page.locator('[data-slot="ack-dialog"]');
      await expect(dialog).toBeVisible();
      const confirm = dialog.getByRole('button', { name: 'Confirm' });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel('I have verified these authorities myself').check();
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(dialog).toBeHidden();
      await expect(
        citationPanel(page).getByText('Acknowledged', { exact: true }).first(),
      ).toBeVisible();
    });

    test('Escape cancels the acknowledgement without recording it', async ({ page }) => {
      await checkCitations(page);
      await citationPanel(page)
        .getByRole('button', { name: 'Acknowledge not-found citations' })
        .click();
      const dialog = page.locator('[data-slot="ack-dialog"]');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(citationPanel(page).getByText('Acknowledged', { exact: true })).toHaveCount(0);
    });

    test('export warns about unverified citations and clears once acknowledged', async ({
      page,
    }) => {
      await checkCitations(page);
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const dialog = page.locator('[data-slot="export-dialog"]');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Word document' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'PDF' })).toBeVisible();
      await expect(dialog.getByText('1 citation is not verified.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
      await expect(
        dialog.getByRole('button', { name: /\b(send|share|file|email)\b/i }),
      ).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Acknowledge', exact: true }).click();
      const ack = page.locator('[data-slot="ack-dialog"]');
      await ack.getByLabel('I have verified these authorities myself').check();
      await ack.getByRole('button', { name: 'Confirm' }).click();
      await expect(ack).toBeHidden();
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await expect(
        page.locator('[data-slot="export-dialog"]').getByText('1 citation is not verified.'),
      ).toHaveCount(0);
    });
  });
});
