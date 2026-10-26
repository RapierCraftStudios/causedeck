// Shared helpers for the offline court-day specs (#65 part 6, #747): wait for the 7-day prefetch,
// read what the device holds without decrypting it, and go offline with the service worker in
// control. The store is one IndexedDB per user and workspace (`causedeck-offline:<user>:<ws>`,
// apps/web/lib/offline/db.ts) and its payloads are sealed, so rows can be counted but not read.
import type { BrowserContext, Page } from '@playwright/test';

import { expect } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

export type OfflineStore = 'courtDay' | 'briefs' | 'outbox';

/** Names of the offline stores in this browser profile. */
export function offlineDbNames(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await indexedDB.databases())
      .map((entry) => entry.name ?? '')
      .filter((name) => name.startsWith('causedeck-offline:')),
  );
}

/** Rows in `store`, summed over every offline database of the profile. */
export function savedRows(page: Page, store: OfflineStore): Promise<number> {
  return page.evaluate(async (storeName) => {
    let total = 0;
    for (const entry of await indexedDB.databases()) {
      if (!entry.name?.startsWith('causedeck-offline:')) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(entry.name as string);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('indexedDB.open failed'));
        };
      });
      try {
        if (!db.objectStoreNames.contains(storeName)) continue;
        total += await new Promise<number>((resolve, reject) => {
          const count = db.transaction(storeName, 'readonly').objectStore(storeName).count();
          count.onsuccess = () => {
            resolve(count.result);
          };
          count.onerror = () => {
            reject(count.error ?? new Error('count failed'));
          };
        });
      } finally {
        db.close();
      }
    }
    return total;
  }, store);
}

/** Rows in `store` of every offline database of the profile, keyed by database name. */
export function savedRowsByDb(page: Page, store: OfflineStore): Promise<Record<string, number>> {
  return page.evaluate(async (storeName) => {
    const rows: Record<string, number> = {};
    for (const entry of await indexedDB.databases()) {
      if (!entry.name?.startsWith('causedeck-offline:')) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(entry.name as string);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('indexedDB.open failed'));
        };
      });
      try {
        rows[entry.name] = !db.objectStoreNames.contains(storeName)
          ? 0
          : await new Promise<number>((resolve, reject) => {
              const count = db.transaction(storeName, 'readonly').objectStore(storeName).count();
              count.onsuccess = () => {
                resolve(count.result);
              };
              count.onerror = () => {
                reject(count.error ?? new Error('count failed'));
              };
            });
      } finally {
        db.close();
      }
    }
    return rows;
  }, store);
}

/**
 * Wait until `count` offline databases exist and each one has saved a court day and a brief. The
 * profile-wide `waitForPrefetch` is already satisfied by the first member's rows, so it cannot tell
 * when a second member's own store is filled (the page-load prefetch starts 10 s after sign-in).
 */
export async function waitForEveryStore(page: Page, count: number): Promise<void> {
  for (const store of ['courtDay', 'briefs'] as const) {
    await expect
      .poll(
        async () => {
          const rows = Object.values(await savedRowsByDb(page, store));
          return rows.length === count && rows.every((n) => n > 0);
        },
        { timeout: 45_000 },
      )
      .toBe(true);
  }
}

/** Wait until the prefetch after sign-in has saved at least one court day and one brief. */
export async function waitForPrefetch(page: Page): Promise<void> {
  await expect.poll(() => savedRows(page, 'courtDay'), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => savedRows(page, 'briefs'), { timeout: 30_000 }).toBeGreaterThan(0);
}

/**
 * Take the browser offline for real: the service worker must control the page first (it serves the
 * data-free shell for `/today`, `/tomorrow` and briefs), which on a first visit needs one reload.
 */
export async function goOffline(page: Page, context: BrowserContext): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload();
    await contentReady(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  }
  await context.setOffline(true);
}

/** The offline board (client rendered from the device store) is on screen. */
export async function expectOfflineBoard(page: Page): Promise<void> {
  await expect(page.locator('[data-offline-board]')).toBeVisible();
}

/** Listing id of the brief linked from the offline board entry titled `title`. */
export async function briefHref(page: Page, title: string): Promise<string> {
  const href = await page
    .locator('[data-offline-board] a[href*="/briefs/"]', { hasText: title })
    .first()
    .getAttribute('href');
  if (href === null) throw new Error(`e2e: no saved brief link for "${title}"`);
  return href;
}
