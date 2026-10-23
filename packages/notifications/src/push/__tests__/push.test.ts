// Web Push (#197): VAPID config with a disabled fallback, content-free payloads unless the member
// turned on `Show details on lock screen`, owner-checked subscriptions, and a sender (stubbed
// `web-push` client) that signs with the VAPID keys and revokes subscriptions on 404/410.
// Database cases run in a rolled-back transaction (`withTestDb`).
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { describe, expect, it } from 'vitest';

import { getNotificationSetting, NotificationError, setLockScreenDetails } from '../../index.ts';
import {
  activeSubscriptions,
  buildPushPayload,
  createPushSender,
  generateVapidKeys,
  GENERIC_PUSH_TITLES,
  PushDeliveryError,
  pushConfig,
  revokeSubscription,
  saveSubscription,
  type PushMessage,
  type WebPushClient,
} from '../index.ts';

const APP_URL = 'https://app.causedeck.test';
const keys = generateVapidKeys();
const env = {
  APP_URL,
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: new Secret(keys.privateKey),
};

const SECRET_TITLE = 'Hearing tomorrow: Sharma v. Union of India, W.P. 1234/2026';
const SECRET_BODY = 'Draft affidavit para 4: the petitioner Ravi Sharma states';

function message(overrides: Partial<PushMessage> = {}): PushMessage {
  return {
    notificationId: randomUUID(),
    userId: randomUUID(),
    category: 'reminder.hearing',
    title: SECRET_TITLE,
    body: SECRET_BODY,
    href: `${APP_URL}/w/acme/matters/1`,
    showDetails: false,
    ...overrides,
  };
}

const subscription = (n: string = randomUUID()) => ({
  endpoint: `https://push.example.test/send/${n}`,
  expirationTime: null,
  keys: { p256dh: `p256-${n}`, auth: `auth-${n}` },
});

/** A web-push stand-in: records calls and answers per endpoint (`status` → WebPushError-like). */
function stubClient(statusFor: (endpoint: string) => number = () => 201) {
  const calls: {
    endpoint: string;
    payload: string;
    options: Parameters<WebPushClient['sendNotification']>[2];
  }[] = [];
  const client: WebPushClient = {
    sendNotification: (sub, payload, options) => {
      calls.push({ endpoint: sub.endpoint, payload, options });
      const statusCode = statusFor(sub.endpoint);
      if (statusCode >= 400) {
        return Promise.reject(Object.assign(new Error('push failed'), { statusCode }));
      }
      return Promise.resolve({ statusCode });
    },
  };
  return { client, calls };
}

async function addUser(tx: Transaction): Promise<string> {
  const [u] = await tx
    .insert(schema.user)
    .values({ name: 'Member', email: `m-${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!u) throw new Error('user insert failed');
  return u.id;
}

async function subRows(tx: Transaction, userId: string) {
  return tx
    .select()
    .from(schema.pushSubscription)
    .where(eq(schema.pushSubscription.userId, userId));
}

describe('push: VAPID config and disabled fallback', () => {
  it('is disabled, without throwing, when the VAPID keys are absent', () => {
    expect(pushConfig({ APP_URL })).toBeNull();
    expect(pushConfig({ APP_URL, VAPID_PUBLIC_KEY: keys.publicKey })).toBeNull();
    expect(createPushSender({ env: { APP_URL } })).toBeUndefined();
  });

  it('is enabled by env alone, with a mailto subject derived from APP_URL by default', () => {
    expect(pushConfig(env)).toMatchObject({
      publicKey: keys.publicKey,
      subject: 'mailto:push@app.causedeck.test',
    });
    expect(pushConfig({ ...env, VAPID_SUBJECT: 'mailto:ops@causedeck.in' })?.subject).toBe(
      'mailto:ops@causedeck.in',
    );
    expect(createPushSender({ env })).toBeDefined();
  });

  it('never exposes the private key through serialisation', () => {
    expect(JSON.stringify(pushConfig(env))).not.toContain(keys.privateKey);
  });
});

describe('push: payloads', () => {
  it('carries no matter names, party names or document text by default', () => {
    const payload = buildPushPayload(message());
    const json = JSON.stringify(payload);
    expect(json).not.toContain('Sharma');
    expect(json).not.toContain('1234/2026');
    expect(json).not.toContain('affidavit');
    expect(payload).toEqual({
      title: GENERIC_PUSH_TITLES['reminder.hearing'],
      href: `${APP_URL}/w/acme/matters/1`,
      tag: expect.stringMatching(/^n:/) as string,
    });
    expect(buildPushPayload(message({ category: 'unknown.thing' })).title).toBe('New notification');
  });

  it('shows the title and body only with `Show details on lock screen` on', () => {
    const payload = buildPushPayload(message({ showDetails: true }));
    expect(payload.title).toBe(SECRET_TITLE);
    expect(payload.body).toBe(SECRET_BODY);
    expect(buildPushPayload(message({ showDetails: true, body: null })).body).toBeUndefined();
  });
});

describe('push: sender', () => {
  it('sends a VAPID-signed push to every active subscription and marks them used', async () => {
    await withTestDb(async (tx) => {
      const userId = await addUser(tx);
      await saveSubscription(tx, userId, subscription('a'));
      await saveSubscription(tx, userId, subscription('b'));
      const { client, calls } = stubClient();
      const sender = createPushSender({ env, client });
      const result = await sender?.send(message({ userId }), tx);

      expect(result).toEqual({ delivered: 2, revoked: 0, failed: 0 });
      expect(calls.map((c) => c.endpoint).sort()).toEqual([
        subscription('a').endpoint,
        subscription('b').endpoint,
      ]);
      const details = calls[0]?.options.vapidDetails;
      expect(details).toEqual({
        subject: 'mailto:push@app.causedeck.test',
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      });
      // The details produce a real VAPID JWT signature for the push service's origin.
      const headers = webpush.getVapidHeaders(
        'https://push.example.test',
        details?.subject ?? '',
        keys.publicKey,
        keys.privateKey,
        'aes128gcm',
      );
      expect(headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
      expect(JSON.parse(calls[0]?.payload ?? '{}')).toMatchObject({
        title: GENERIC_PUSH_TITLES['reminder.hearing'],
      });
      expect(calls[0]?.payload).not.toContain('Sharma');
      expect((await subRows(tx, userId)).every((r) => r.lastUsedAt !== null)).toBe(true);
    });
  });

  it('revokes a subscription the push service answers 404 or 410 for', async () => {
    await withTestDb(async (tx) => {
      const userId = await addUser(tx);
      for (const n of ['ok', 'gone', 'missing'])
        await saveSubscription(tx, userId, subscription(n));
      const { client } = stubClient((endpoint) =>
        endpoint.endsWith('/gone') ? 410 : endpoint.endsWith('/missing') ? 404 : 201,
      );
      const result = await createPushSender({ env, client })?.send(message({ userId }), tx);

      expect(result).toEqual({ delivered: 1, revoked: 2, failed: 0 });
      const active = await activeSubscriptions(tx, userId);
      expect(active.map((s) => s.endpoint)).toEqual([subscription('ok').endpoint]);
      // A revoked subscription is not tried again.
      const second = stubClient();
      await createPushSender({ env, client: second.client })?.send(message({ userId }), tx);
      expect(second.calls).toHaveLength(1);
    });
  });

  it('throws (so the job retries) only when no subscription received the push', async () => {
    await withTestDb(async (tx) => {
      const userId = await addUser(tx);
      await saveSubscription(tx, userId, subscription('down'));
      const down = stubClient(() => 503);
      const error: unknown = await createPushSender({ env, client: down.client })
        ?.send(message({ userId }), tx)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PushDeliveryError);
      expect(await activeSubscriptions(tx, userId)).toHaveLength(1);

      await saveSubscription(tx, userId, subscription('up'));
      const mixed = stubClient((endpoint) => (endpoint.endsWith('/down') ? 503 : 201));
      await expect(
        createPushSender({ env, client: mixed.client })?.send(message({ userId }), tx),
      ).resolves.toEqual({ delivered: 1, revoked: 0, failed: 1 });
    });
  });

  it('sends nothing to a user without subscriptions', async () => {
    await withTestDb(async (tx) => {
      const userId = await addUser(tx);
      const { client, calls } = stubClient();
      await expect(
        createPushSender({ env, client })?.send(message({ userId }), tx),
      ).resolves.toEqual({ delivered: 0, revoked: 0, failed: 0 });
      expect(calls).toEqual([]);
    });
  });
});

describe('push: subscriptions', () => {
  it('stores, re-activates and revokes only the caller own subscription', async () => {
    await withTestDb(async (tx) => {
      const alice = await addUser(tx);
      const bob = await addUser(tx);
      const sub = subscription();
      await saveSubscription(tx, alice, sub, 'Mozilla/5.0 Test');
      expect(await subRows(tx, alice)).toMatchObject([
        { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, revokedAt: null },
      ]);

      // Bob cannot revoke Alice's endpoint.
      expect(await revokeSubscription(tx, bob, sub.endpoint)).toBe(false);
      expect(await activeSubscriptions(tx, alice)).toHaveLength(1);

      expect(await revokeSubscription(tx, alice, sub.endpoint)).toBe(true);
      expect(await activeSubscriptions(tx, alice)).toEqual([]);
      expect(await revokeSubscription(tx, alice, sub.endpoint)).toBe(false);

      // Subscribing again re-activates the same row.
      await saveSubscription(tx, alice, sub);
      expect(await subRows(tx, alice)).toHaveLength(1);
      expect(await activeSubscriptions(tx, alice)).toHaveLength(1);
    });
  });

  it('rejects malformed subscriptions', async () => {
    await withTestDb(async (tx) => {
      const userId = await addUser(tx);
      const bad: unknown[] = [
        {},
        { endpoint: 'http://push.example.test/x', keys: { p256dh: 'p', auth: 'a' } },
        { endpoint: 'https://push.example.test/x', keys: { p256dh: '', auth: 'a' } },
        { endpoint: 'not a url', keys: { p256dh: 'p', auth: 'a' } },
      ];
      for (const input of bad) {
        const error: unknown = await saveSubscription(tx, userId, input).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotificationError);
        expect((error as NotificationError).code).toBe('VALIDATION');
      }
      expect(await subRows(tx, userId)).toEqual([]);
    });
  });
});

describe('push: `Show details on lock screen` setting', () => {
  it('defaults to off and persists per member and workspace', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      const userId = await addUser(tx);
      await inWorkspace(tx, a.id, (s) =>
        s.insert(schema.member).values({ organizationId: a.id, userId, role: 'junior' }),
      );
      const ctx = { db: tx, workspaceId: a.id };
      expect(await getNotificationSetting(ctx, { userId })).toEqual({
        courtHoursQuiet: false,
        lockScreenDetails: false,
      });
      expect(await setLockScreenDetails(ctx, { userId, enabled: true })).toMatchObject({
        lockScreenDetails: true,
      });
      expect((await getNotificationSetting(ctx, { userId })).lockScreenDetails).toBe(true);
      await setLockScreenDetails(ctx, { userId, enabled: false });
      expect((await getNotificationSetting(ctx, { userId })).lockScreenDetails).toBe(false);
    });
  });
});
