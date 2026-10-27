// Outward drafts journeys (#737, part 3 of #69) on `/w/chennai-solo/drafts`: edit and save, copy,
// the `wa.me` and `mailto:` hand-offs (opened by the lawyer in a new window with the text filled
// in; the server only records the share), mark shared, the keyboard-only flow and every state.
// Drafts are seeded (outward-drafts-helpers.ts: the e2e stack has no AI or job worker). `@a11y`
// tests end on the state they name, so axe runs on it; the matrix covers 360/768/1280, light and
// dark. Runs in CI only; fictional data.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';
import { CLERK_WORKSPACE, SHELL_WORKSPACE, contentReady } from '../shell/helpers.ts';

import {
  CLIENT_TEXT,
  DRAFTS_PATH,
  EDITED_TEXT,
  seedDrafts,
  shareCount,
} from './outward-drafts-helpers.ts';

/** Record `window.open` calls instead of opening a real window (no traffic to wa.me or a mail app). */
async function captureWindowOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    (window as unknown as { __opened: unknown[][] }).__opened = calls;
    window.open = (...args: unknown[]) => {
      calls.push(args);
      return null;
    };
  });
}

const opened = (page: Page): Promise<string[][]> =>
  page.evaluate(() => (window as unknown as { __opened: string[][] }).__opened);

const editorBox = (page: Page) => page.getByRole('textbox', { name: /^Draft text for / });
const status = (page: Page) => page.locator('[data-slot="draft-editor"] [aria-live="polite"]');

test.describe('outward drafts journeys', () => {
  test(
    'the list shows each draft and opens one beside it',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      const drafts = await seedDrafts(db.name);
      await asUser('owner', { path: DRAFTS_PATH });
      await contentReady(page);
      const list = page.getByRole('list', { name: 'Drafts waiting to be sent' });
      // Five are seeded; the shared one has left the queue (listDrafts lists what still waits).
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await page.getByRole('button', { name: /^Open draft for Ramaswamy/ }).click();
      await expect(page).toHaveURL(new RegExp(`[?&]draft=${drafts.client}`));
      await expect(editorBox(page)).toHaveValue(CLIENT_TEXT);
      await expect(page.getByRole('note')).toContainText('CauseDeck does not send messages');
    },
  );

  test(
    'editing saves the lawyer text and keeps the prepared text for the diff',
    {
      tag: '@a11y',
    },
    async ({ page, asUser, db }) => {
      const drafts = await seedDrafts(db.name);
      await asUser('owner', { path: `${DRAFTS_PATH}?draft=${drafts.client}` });
      await contentReady(page);
      const save = page.getByRole('button', { name: 'Save edit' });
      await expect(save).toBeDisabled();
      const edited = `${CLIENT_TEXT} Please call the office with questions.`;
      await editorBox(page).fill(edited);
      await save.click();
      await expect(status(page)).toHaveText('Edit saved');
      await page.reload();
      await contentReady(page);
      await expect(editorBox(page)).toHaveValue(edited);
      await page.getByRole('button', { name: 'Compare with the prepared text' }).click();
      const diff = page.getByRole('group', { name: 'Changes from the prepared text' });
      await expect(diff).toContainText('Please call the office');
    },
  );

  test(
    'the diff view marks added and removed words with text, not only colour',
    {
      tag: '@a11y',
    },
    async ({ page, asUser, db }) => {
      const drafts = await seedDrafts(db.name);
      await asUser('owner', { path: `${DRAFTS_PATH}?draft=${drafts.edited}` });
      await contentReady(page);
      await expect(editorBox(page)).toHaveValue(EDITED_TEXT);
      const toggle = page.getByRole('button', { name: 'Compare with the prepared text' });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      const diff = page.getByRole('group', { name: 'Changes from the prepared text' });
      await expect(diff).toBeVisible();
      await expect(diff.getByText('Added').first()).toBeAttached();
      await expect(diff.getByText('Removed').first()).toBeAttached();
    },
  );

  test('copy puts the draft text on the clipboard', async ({ page, asUser, db, context }, info) => {
    test.skip(info.project.name.startsWith('webkit'), 'clipboard permissions are chromium only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const drafts = await seedDrafts(db.name);
    await asUser('owner', { path: `${DRAFTS_PATH}?draft=${drafts.client}` });
    await contentReady(page);
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(status(page)).toHaveText('Copied to the clipboard');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CLIENT_TEXT);
  });

  test('WhatsApp and email open in a new window with the text filled in; the server sends nothing', async ({
    page,
    asUser,
    db,
    workerServer,
  }) => {
    const drafts = await seedDrafts(db.name);
    await captureWindowOpen(page);
    const external: string[] = [];
    const posts: string[] = [];
    const origin = new URL(workerServer.url).origin;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== origin) {
        external.push(request.url());
      }
      if (request.method() === 'POST') posts.push(request.headers()['next-action'] ?? 'no-action');
    });
    await asUser('owner', { path: `${DRAFTS_PATH}?draft=${drafts.client}` });
    await contentReady(page);

    await page.getByRole('button', { name: 'Open in WhatsApp' }).click();
    await expect(status(page)).toHaveText('Recorded as shared by you');
    await page.getByRole('button', { name: 'Open in email' }).click();
    await expect.poll(() => shareCount(db.name, drafts.client)).toBe(2);

    const calls = await opened(page);
    expect(calls).toHaveLength(2);
    const [wa, mail] = calls;
    if (wa === undefined || mail === undefined) throw new Error('both hand-offs should open');
    expect(wa[0]).toBe(`https://wa.me/?text=${encodeURIComponent(CLIENT_TEXT)}`);
    expect(wa[1]).toBe('_blank');
    expect(wa[2]).toContain('noopener');
    expect(mail[0]).toBe(
      `mailto:?subject=${encodeURIComponent('Update on Ramaswamy v. State of Tamil Nadu (fictional)')}&body=${encodeURIComponent(CLIENT_TEXT)}`,
    );
    expect(mail[2]).toContain('noopener');
    // Nothing is sent by the server: no request left the app, and the only writes are the
    // recorded shares (server actions).
    expect(external).toEqual([]);
    expect(posts.filter((p) => p === 'no-action')).toEqual([]);
  });

  test('mark shared records the share and the card says so', async ({ page, asUser, db }) => {
    const drafts = await seedDrafts(db.name);
    await asUser('owner', { path: `${DRAFTS_PATH}?draft=${drafts.client}` });
    await contentReady(page);
    expect(await shareCount(db.name, drafts.client)).toBe(0);
    await page.getByRole('button', { name: 'Mark shared' }).click();
    await expect(status(page)).toHaveText('Recorded as shared by you');
    await expect.poll(() => shareCount(db.name, drafts.client)).toBe(1);
  });

  test('keyboard only: copy, diff, close', async ({ page, asUser, db, context }, info) => {
    if (!info.project.name.startsWith('webkit')) {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    }
    const drafts = await seedDrafts(db.name);
    // The edited draft: an unedited one has no changes, so its diff shows no group.
    await asUser('owner', { path: `${DRAFTS_PATH}?draft=${drafts.edited}` });
    await contentReady(page);
    await editorBox(page).focus();
    await page.keyboard.press('Control+Enter');
    await expect(status(page)).toHaveText(/Copied to the clipboard|Could not copy/);
    // Tab leaves the text box for the buttons; `d` toggles the diff when focus is not in it.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save edit' })).toBeDisabled();
    await page.getByRole('button', { name: 'Compare with the prepared text' }).focus();
    await page.keyboard.press('d');
    await expect(page.getByRole('group', { name: 'Changes from the prepared text' })).toBeVisible();
    await page.keyboard.press('d');
    await expect(page.getByRole('group', { name: 'Changes from the prepared text' })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/draft=/);
  });

  test('Tamil and Kannada drafts keep their language and script', async ({ page, asUser, db }) => {
    const drafts = await seedDrafts(db.name);
    await asUser('owner', { path: `${DRAFTS_PATH}?draft=${drafts.tamil}` });
    await contentReady(page);
    await expect(editorBox(page)).toHaveAttribute('lang', 'ta');
    await page.goto(`/w/${SHELL_WORKSPACE}/${DRAFTS_PATH}?draft=${drafts.kannada}`);
    await expect(editorBox(page)).toHaveAttribute('lang', 'kn');
  });

  test('does not scroll sideways', async ({ page, asUser, db }) => {
    const drafts = await seedDrafts(db.name);
    await asUser('owner', { path: `${DRAFTS_PATH}?draft=${drafts.client}` });
    await contentReady(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('outward drafts states', { tag: '@a11y' }, () => {
  test('empty', async ({ page, asUser }) => {
    await asUser('owner', { path: DRAFTS_PATH });
    await expect(page.getByText('No updates waiting')).toBeVisible();
  });

  test('loading', async ({ page, asUser }) => {
    await asUser('owner', { path: `${DRAFTS_PATH}?__state=loading` });
    await expect(page.locator('[data-slot="drafts-skeleton"]')).toBeVisible();
  });

  test('offline', async ({ page, asUser }) => {
    await asUser('owner', { path: `${DRAFTS_PATH}?__state=offline` });
    await expect(page.getByText(/You are offline\. You can keep editing/)).toBeVisible();
  });

  test('error', async ({ page, asUser }) => {
    await asUser('owner', { path: `${DRAFTS_PATH}?__state=error` });
    // The boundary keeps the page heading; the failure is the alert below it.
    const alert = page.locator('main').getByRole('alert');
    await expect(alert).toContainText('Drafts could not be loaded', { timeout: 15_000 });
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('denied for a clerk', async ({ page, asUser }) => {
    await asUser('owner');
    await page.goto(`/w/${CLERK_WORKSPACE}/${DRAFTS_PATH}`);
    await expect(page.locator('main')).toContainText(
      'You do not have access to outward drafts in this workspace.',
    );
  });
});
