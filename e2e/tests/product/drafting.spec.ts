// Drafting studio journeys (#829) on `/w/chennai-solo/drafts`: create from a template, save and the
// studio keys, the offline queue, reduced motion, and no send, share or file control. The check,
// acknowledge and export flows wait for #828's panels and dialogs. Runs in CI only.
import { DRAFTING, DRAFTING_WORKSPACE } from '../../fixtures/drafting-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

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
    await context.setOffline(true);
    await page.getByRole('textbox', { name: 'Draft editor' }).first().fill('Edited offline');
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
});
