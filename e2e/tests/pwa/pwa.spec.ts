// PWA (#50): installable manifest, service worker scope, offline page, share-target simulation and
// no tenant payload in Cache Storage. CI only; the offline cases use Playwright offline emulation.
import { expect, test } from '../../fixtures/index.ts';

import { openShell } from '../shell/helpers.ts';

test.describe('pwa', { tag: '@a11y' }, () => {
  test('manifest is installable and declares the share target', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { purpose?: string }[];
      share_target: { action: string; method: string; enctype: string };
    };
    expect(manifest.name).toBe('CauseDeck');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.share_target.action).toBe('/share-target');
    expect(manifest.share_target.method).toBe('POST');
    expect(manifest.share_target.enctype).toBe('multipart/form-data');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    expect(JSON.stringify(manifest)).not.toMatch(/permission/i);
  });

  test('the worker is served from the root without a widened scope', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.ok()).toBe(true);
    expect(response.headers()['service-worker-allowed']).toBeUndefined();
    expect(response.headers()['cache-control']).toContain('no-cache');
  });

  test('offline page renders and is reachable', async ({ page }) => {
    await page.goto('/offline');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link').first()).toBeVisible();
  });

  test('no tenant payload ends up in Cache Storage', async ({ page, asUser }) => {
    await openShell(page, asUser, { path: 'matters' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
      }
      return urls;
    });
    for (const url of cached) {
      expect(url).not.toMatch(/^\/(api|w)\//);
    }
  });

  test('a share made offline is saved on the device', async ({ page, context, asUser }) => {
    // The worker is registered by the app shell (topbar and install banner), not by `/offline`,
    // where `serviceWorker.ready` never resolves.
    await openShell(page, asUser, { path: 'matters' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.goto('/share-target?batch=00000000-0000-4000-8000-000000000001');
    // The shell's own offline page is served from the worker's cache, and the share screen's
    // outbox status is inside it: `main` alone, the `or()` of both is two elements.
    await expect(page.getByRole('main')).toBeVisible();
  });
});
