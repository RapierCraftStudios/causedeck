// @vitest-environment jsdom
// Push permission card (#197): never prompts on load, hidden when push is disabled or unsupported,
// `Turn on` asks for permission, subscribes with the VAPID key and stores the subscription, and
// `Not now` hides it for good. The real browser flow is e2e/tests/notifications/push.spec.ts.
import { generateKeyPairSync } from 'node:crypto';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';
import {
  PUSH_CARD_DISMISSED_KEY,
  PushPermissionCard,
  vapidKeyBytes,
} from '../push-permission-card.tsx';

/** A P-256 public key generated per run (#271): the uncompressed point, URL-safe base64. */
const KEY = (() => {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  });
  return Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? '', 'base64url'),
    Buffer.from(jwk.y ?? '', 'base64url'),
  ]).toString('base64url');
})();
const SUB_JSON = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'p', auth: 'a' } };

const browser = {
  requestPermission: vi.fn<() => Promise<NotificationPermission>>(),
  subscribe: vi.fn(),
  register: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
  permission: 'default' as NotificationPermission,
};

function installPush() {
  const pushManager = {
    getSubscription: () => Promise.resolve(null),
    subscribe: browser.subscribe,
  };
  const registration = { pushManager };
  Object.assign(window, { PushManager: function PushManager() {} });
  Object.assign(window, {
    Notification: {
      get permission() {
        return browser.permission;
      },
      requestPermission: browser.requestPermission,
    },
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: () => Promise.resolve(undefined),
      register: browser.register,
      ready: Promise.resolve(registration),
    },
  });
  browser.subscribe.mockResolvedValue({ toJSON: () => SUB_JSON });
  browser.register.mockResolvedValue(registration);
  browser.fetch.mockResolvedValue(new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', browser.fetch);
}

function uninstallPush() {
  Reflect.deleteProperty(window, 'PushManager');
  Reflect.deleteProperty(window, 'Notification');
  Reflect.deleteProperty(navigator, 'serviceWorker');
}

function renderCard(key: string | null = KEY) {
  return render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      <PushPermissionCard vapidPublicKey={key} />
    </NextIntlClientProvider>,
  );
}

const copy = catalogs.en.notifications.push.card;

/** jsdom without a URL has no usable `localStorage`; a Map-backed one stands in. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
  browser.permission = 'default';
});

afterEach(() => {
  cleanup();
  uninstallPush();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PushPermissionCard', () => {
  it('shows the copy and buttons without prompting on load', async () => {
    installPush();
    renderCard();
    expect(await screen.findByText(copy.body)).not.toBeNull();
    expect(copy.body).toBe('Get a nudge before your hearings. You can change this any time.');
    expect(screen.getByRole('button', { name: 'Turn on' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Not now' })).not.toBeNull();
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(browser.register).not.toHaveBeenCalled();
  });

  it('is hidden when the browser cannot do Web Push', async () => {
    const { container } = renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });

  it('is hidden when push is disabled on the server or notifications are blocked', async () => {
    installPush();
    const disabled = renderCard(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(disabled.container.innerHTML).toBe('');
    cleanup();
    browser.permission = 'denied';
    const blocked = renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(blocked.container.innerHTML).toBe('');
  });

  it('Turn on: asks for permission, subscribes with the VAPID key and stores it', async () => {
    installPush();
    browser.requestPermission.mockImplementation(() => {
      browser.permission = 'granted';
      return Promise.resolve('granted');
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText(copy.enabled)).not.toBeNull();
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(browser.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(KEY),
    });
    expect(browser.fetch).toHaveBeenCalledWith('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SUB_JSON),
    });
  });

  it('Turn on: a refused permission subscribes nothing', async () => {
    installPush();
    browser.requestPermission.mockResolvedValue('denied');
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText(copy.blocked)).not.toBeNull();
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(browser.fetch).not.toHaveBeenCalled();
  });

  it('Turn on: a failed save shows an error', async () => {
    installPush();
    browser.requestPermission.mockResolvedValue('granted');
    renderCard();
    browser.fetch.mockResolvedValue(new Response('{}', { status: 503 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText(copy.error)).not.toBeNull();
  });

  it('Not now: hides the card and keeps it hidden', async () => {
    installPush();
    const { container } = renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => {
      expect(container.innerHTML).toBe('');
    });
    expect(window.localStorage.getItem(PUSH_CARD_DISMISSED_KEY)).toBe('1');
    cleanup();
    const again = renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(again.container.innerHTML).toBe('');
    expect(browser.requestPermission).not.toHaveBeenCalled();
  });
});

describe('vapidKeyBytes', () => {
  it('decodes a URL-safe base64 P-256 public key to 65 bytes', () => {
    const bytes = vapidKeyBytes(KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });
});
