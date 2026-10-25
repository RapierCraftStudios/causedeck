// Web Push subscribe (#197): the permission prompt only follows a click on `Turn on`, never page
// load; the push service worker registers under the CSP; the browser's subscription is stored for
// the signed-in user and `POST /api/push/unsubscribe` revokes it. Headless Chromium has no push
// service, so `PushManager.subscribe` and `Notification.requestPermission` are stubbed in the page;
// sending (VAPID signing, 404/410 revocation) is covered with a stubbed `web-push` in
// packages/notifications/src/push/__tests__/push.test.ts.
import type { Page } from '@playwright/test';
import postgres from 'postgres';

import { expect, test } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';

const ENDPOINT = 'https://push.example.test/e2e/subscription-1';

/** Stub the browser push APIs: counts permission prompts, returns a fixed subscription. */
async function stubPush(page: Page, { supported = true } = {}) {
  await page.addInitScript(
    ({ endpoint, supported: hasPush }) => {
      const w = window as unknown as Record<string, unknown>;
      if (!hasPush) {
        delete w.PushManager;
        return;
      }
      let permission: NotificationPermission = 'default';
      w.__permissionPrompts = 0;
      Object.defineProperty(Notification, 'permission', { get: () => permission });
      Notification.requestPermission = () => {
        w.__permissionPrompts = (w.__permissionPrompts as number) + 1;
        permission = 'granted';
        return Promise.resolve(permission);
      };
      let current: PushSubscription | null = null;
      PushManager.prototype.getSubscription = () => Promise.resolve(current);
      PushManager.prototype.subscribe = (options?: PushSubscriptionOptionsInit) => {
        w.__applicationServerKeyBytes = options?.applicationServerKey
          ? new Uint8Array(options.applicationServerKey as ArrayBuffer).length
          : 0;
        current = {
          endpoint,
          toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'BPk', auth: 'au' } }),
        } as unknown as PushSubscription;
        return Promise.resolve(current);
      };
    },
    { endpoint: ENDPOINT, supported },
  );
}

async function subscriptionRows(database: string) {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    return await sql<{ user_id: string; endpoint: string; revoked_at: Date | null }[]>`
      select user_id, endpoint, revoked_at from push_subscription where endpoint = ${ENDPOINT}`;
  } finally {
    await sql.end();
  }
}

const card = (page: Page) => page.locator('[data-push-card]');

test.describe('web push subscription', () => {
  test('subscribes from an explicit button, stores and revokes the subscription', async ({
    page,
    asUser,
    db,
  }) => {
    await stubPush(page);
    // The card moved from the settings index to the notification preferences (#284).
    await asUser('owner', { path: 'settings/notifications' });
    await expect(
      card(page).getByText('Get a nudge before your hearings. You can change this any time.'),
    ).toBeVisible();
    // Nothing prompted on load.
    expect(
      await page.evaluate(() => (window as unknown as Record<string, number>).__permissionPrompts),
    ).toBe(0);

    await card(page).getByRole('button', { name: 'Turn on' }).click();
    await expect(card(page).getByRole('status')).toHaveText(
      'Push notifications are on for this browser.',
    );
    const prompts = await page.evaluate(() => {
      const w = window as unknown as Record<string, number>;
      return { prompts: w.__permissionPrompts, keyBytes: w.__applicationServerKeyBytes };
    });
    expect(prompts).toEqual({ prompts: 1, keyBytes: 65 });

    // The PWA service worker (#50) registered at `/`; it loads the push handlers.
    const script = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      return (registration?.active ?? registration?.installing ?? registration?.waiting)?.scriptURL;
    });
    expect(script).toMatch(/\/sw\.js$/);
    expect((await page.request.get('/push-sw-handler.js')).ok()).toBe(true);

    const [stored] = await subscriptionRows(db.name);
    expect(stored).toMatchObject({ endpoint: ENDPOINT, revoked_at: null });

    const response = await page.request.post('/api/push/unsubscribe', {
      data: { endpoint: ENDPOINT },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revoked: true });
    const [revoked] = await subscriptionRows(db.name);
    expect(revoked?.revoked_at).not.toBeNull();
  });

  test('Not now hides the card without prompting', async ({ page, asUser }) => {
    await stubPush(page);
    await asUser('owner', { path: 'settings/notifications' });
    await card(page).getByRole('button', { name: 'Not now' }).click();
    await expect(card(page)).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-route="notification-preferences"]')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as Record<string, number>).__permissionPrompts),
    ).toBe(0);
  });

  test('the card is hidden when the browser has no Web Push', async ({ page, asUser }) => {
    await stubPush(page, { supported: false });
    await asUser('owner', { path: 'settings/notifications' });
    await expect(page.locator('[data-route="notification-preferences"]')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });

  test('the subscribe API refuses signed-out callers', async ({ page }) => {
    await page.context().clearCookies();
    const response = await page.request.post('/api/push/subscribe', {
      data: { endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } },
    });
    expect(response.status()).toBe(401);
  });
});
