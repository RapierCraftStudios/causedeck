// WhatsApp import (#527, part 3 of #55) on `/w/<shell workspace>/inbox/import/whatsapp`: a dark flag
// is a 404, a viewer is denied, a client conversation stops before any file is read, and an
// internal chat is parsed in the browser, previewed, filtered and uploaded as the selected
// messages only (the upload is intercepted: the e2e stack has no job worker). `@a11y` tests run
// axe on the page they end on. Fictional data only.
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

import {
  CHAT_FILE,
  IMPORT_PATH,
  PII_CHAT,
  enableWhatsAppImport,
} from './whatsapp-import-helpers.ts';

const STOP = 'Client conversations stay out of CauseDeck imports for now';

test.describe('whatsapp import', () => {
  test('a dark flag is a plain 404', async ({ page, asUser }) => {
    await asUser('owner', { path: IMPORT_PATH });
    // The workspace not-found page (status 200: it streams behind the loading boundary first).
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText(
      'Page not found',
    );
  });

  test('a viewer is denied', async ({ page, asUser, db }) => {
    await enableWhatsAppImport(db.name);
    await asUser('viewer', { path: IMPORT_PATH });
    await expect(page.getByText('Only owners and advocates can import chats.')).toBeVisible();
  });

  test(
    'a client conversation, or not sure, stops with no file read',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await enableWhatsAppImport(db.name);
      await asUser('owner', { path: IMPORT_PATH });
      await shellReady(page);
      const uploads: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'POST') uploads.push(request.url());
      });
      for (const choice of ['A client conversation', 'Not sure']) {
        await page.getByRole('radio', { name: new RegExp(choice) }).check();
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByText(STOP)).toBeVisible();
        await expect(page.locator('input[type="file"]')).toHaveCount(0);
        await page.getByRole('button', { name: 'Choose again' }).click();
      }
      expect(uploads).toEqual([]);
    },
  );

  test(
    'an internal chat is previewed, held messages stay out and only the selection is uploaded',
    { tag: '@a11y' },
    async ({ page, asUser, db }) => {
      await enableWhatsAppImport(db.name);
      let body: Record<string, unknown> | null = null;
      await page.route('**/api/captures/whatsapp', async (route) => {
        body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ captureId: 'c1', status: 'queued', stored: 2, excluded: 2 }),
        });
      });
      await asUser('owner', { path: IMPORT_PATH });
      await shellReady(page);
      await page.getByRole('radio', { name: /Internal/ }).check();
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByText('What happens to the chat')).toBeVisible();
      await page.locator('input[type="file"]').setInputFiles({
        name: CHAT_FILE,
        mimeType: 'text/plain',
        buffer: Buffer.from(PII_CHAT),
      });
      await expect(page.getByText('2 messages selected of 4')).toBeVisible();
      await expect(page.getByText('Can never be imported')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Include anyway' })).toBeVisible();

      await page.getByRole('searchbox', { name: 'Search messages' }).fill('listing');
      await expect(page.locator('[data-row]')).toHaveCount(1);
      await page.getByRole('searchbox', { name: 'Search messages' }).fill('');

      await page.getByRole('button', { name: /Import 2 messages/ }).click();
      await expect(page.getByText(/Imported\. CauseDeck is reading the chat/)).toBeVisible();
      const sent = body as unknown as {
        chatType: string;
        chatTitleHash: string;
        messages: { text: string }[];
        confirmedIds?: string[];
      };
      expect(sent.chatType).toBe('internal');
      expect(sent.chatTitleHash).toMatch(/^[0-9a-f]{64}$/);
      expect(sent.messages.map((m) => m.text)).toEqual([
        'Filing is done',
        'Thanks, listing is on Monday',
      ]);
      expect(JSON.stringify(sent)).not.toContain('2345 6789 0123');
      expect(JSON.stringify(sent)).not.toContain('Chambers');
    },
  );

  test('the keyboard moves between messages and Space includes or excludes', async ({
    page,
    asUser,
    db,
  }) => {
    await enableWhatsAppImport(db.name);
    await asUser('owner', { path: IMPORT_PATH });
    await shellReady(page);
    await page.getByRole('radio', { name: /Internal/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: CHAT_FILE,
      mimeType: 'text/plain',
      buffer: Buffer.from(PII_CHAT),
    });
    const row = (n: number) => page.locator(`[data-row="${String(n)}"] [role="checkbox"]`);
    await row(2).focus();
    await expect(row(2)).toBeChecked();
    await page.keyboard.press('Space');
    await expect(row(2)).not.toBeChecked();
    await expect(page.getByText('1 message selected of 4')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(row(3)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(row(2)).toBeFocused();
    await page.locator('[data-row="1"]').getByRole('button', { name: 'Include anyway' }).focus();
    await page.keyboard.press('c');
    await expect(row(1)).toBeChecked();
  });

  test('offline: choosing is allowed, importing is not', async ({ page, asUser, db, context }) => {
    await enableWhatsAppImport(db.name);
    await asUser('owner', { path: IMPORT_PATH });
    await shellReady(page);
    await page.getByRole('radio', { name: /Internal/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: CHAT_FILE,
      mimeType: 'text/plain',
      buffer: Buffer.from(PII_CHAT),
    });
    await expect(page.getByRole('button', { name: /Import \d+ messages?/ })).toBeEnabled();
    await context.setOffline(true);
    await expect(page.getByText(/You're offline/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Import \d+ messages?/ })).toBeDisabled();
    await context.setOffline(false);
  });

  test('an unreadable file shows the error state', async ({ page, asUser, db }) => {
    await enableWhatsAppImport(db.name);
    await asUser('owner', { path: IMPORT_PATH });
    await shellReady(page);
    await page.getByRole('radio', { name: /Internal/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'WhatsApp Chat with Chambers.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
    });
    await expect(page.getByText('That file is not a valid zip export.')).toBeVisible();
  });
});
