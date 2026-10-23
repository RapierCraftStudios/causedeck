// WhatsApp import budget (#527): a 10,000-message export is parsed in the Web Worker and its
// preview is on screen in under 2 s from choosing the file, and no main-thread long task during
// that window exceeds 50 ms. Desktop project only: wall-clock timing on a shared CI runner.
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

import {
  CHAT_FILE,
  IMPORT_PATH,
  enableWhatsAppImport,
  syntheticChat,
} from './whatsapp-import-helpers.ts';

const MESSAGES = 10_000;
const BUDGET_MS = 2000;
const LONG_TASK_MS = 50;

test.describe('whatsapp import budget', { tag: '@perf' }, () => {
  test(`${String(MESSAGES)} messages preview in under ${String(BUDGET_MS)} ms with no long task over ${String(LONG_TASK_MS)} ms`, async ({
    page,
    asUser,
    db,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1280-light', 'timing runs once, on desktop');
    await enableWhatsAppImport(db.name);
    await asUser('owner', { path: IMPORT_PATH });
    await shellReady(page);
    await page.getByRole('radio', { name: /Internal/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.evaluate(() => {
      const w = window as unknown as { __longTasks: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: false });
    });
    const started = Date.now();
    await page.locator('input[type="file"]').setInputFiles({
      name: CHAT_FILE,
      mimeType: 'text/plain',
      buffer: Buffer.from(syntheticChat(MESSAGES)),
    });
    await expect(
      page.locator('[data-slot="whatsapp-message-list"] [data-row]').first(),
    ).toBeVisible({
      timeout: BUDGET_MS * 3,
    });
    const elapsed = Date.now() - started;
    const longTasks = await page.evaluate(
      () => (window as unknown as { __longTasks: number[] }).__longTasks,
    );
    testInfo.annotations.push({ type: 'preview-ms', description: String(elapsed) });
    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(Math.max(0, ...longTasks)).toBeLessThan(LONG_TASK_MS);
    await expect(page.getByText(/messages selected of 10,?000/)).toBeVisible();
  });
});
