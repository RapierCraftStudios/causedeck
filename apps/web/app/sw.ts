// The CauseDeck service worker (#50), bundled to `public/sw.js` by `lib/pwa/build-sw.ts` (served
// from the root, so its scope is `/` without widening it). It does four things:
//   1. precaches the offline page and serves it for failed navigations;
//   2. caches hashed static assets cache-first and public HTML network-first;
//   3. NEVER caches tenant data: `/api/*`, server actions, RSC payloads and every signed-in route
//      (`/w/**`, `/account`, `/onboarding`, `/share-target`) go to the network only;
//   4. takes the Web Share Target POST: files are encrypted into the outbox on this device before
//      any network call, then the worker answers 303 -> `/share-target?batch=<id>`.
// It also runs the outbox on Background Sync and applies updates only when the page asks (the
// court-day update policy lives in the page), and loads the push handlers (#23).
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from 'serwist';
import type { PrecacheEntry, RuntimeCaching } from 'serwist';

import { isStaticAsset, isTenantRequest, SHARE_PATH } from '../lib/pwa/cache-policy.ts';
import { getDeviceKey } from '../lib/pwa/outbox/crypto.ts';
import { dexieKeyStore, dexieOutboxStore } from '../lib/pwa/outbox/db.ts';
import { enqueueFiles, notifyOutboxChanged, OutboxCapError } from '../lib/pwa/outbox/queue.ts';
import { SYNC_TAG, syncOutbox } from '../lib/pwa/outbox/sync.ts';

/** Replaced by `build-sw.ts` with the precache list. */
declare const __SW_MANIFEST__: (PrecacheEntry | string)[];

interface WorkerScope {
  importScripts(...urls: string[]): void;
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: never) => void): void;
}

interface FetchLike extends Event {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface SyncLike extends Event {
  tag: string;
  waitUntil(promise: Promise<unknown>): void;
}
interface MessageLike extends Event {
  data: unknown;
}

const worker = globalThis as unknown as WorkerScope;

worker.importScripts('/push-sw-handler.js');

const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ request, url, sameOrigin }) => sameOrigin && isTenantRequest(request, url),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && isStaticAsset(url),
    handler: new CacheFirst({
      cacheName: 'static-assets',
      plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 30 * 24 * 60 * 60 })],
    }),
  },
  {
    matcher: ({ request, sameOrigin }) => sameOrigin && request.destination === 'document',
    handler: new NetworkFirst({ cacheName: 'public-html', networkTimeoutSeconds: 3 }),
  },
];

const serwist = new Serwist({
  precacheEntries: __SW_MANIFEST__,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
  fallbacks: {
    entries: [{ url: '/offline', matcher: ({ request }) => request.destination === 'document' }],
  },
});

/** Save the shared files on this device first, then send the person to the share screen. */
async function handleShare(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const see = (query: string) => Response.redirect(`${origin}${SHARE_PATH}${query}`, 303);
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) return see('');
    const store = dexieOutboxStore();
    const key = await getDeviceKey(dexieKeyStore());
    const { batchId } = await enqueueFiles(store, key, files, {
      workspaceId: null,
      channel: 'share',
    });
    notifyOutboxChanged();
    return see(`?batch=${encodeURIComponent(batchId)}`);
  } catch (error) {
    return see(error instanceof OutboxCapError ? '?error=full' : '?error=failed');
  }
}

worker.addEventListener('fetch', (event: FetchLike) => {
  const { request } = event;
  if (request.method === 'POST' && new URL(request.url).pathname === SHARE_PATH) {
    event.respondWith(handleShare(request));
  }
});

worker.addEventListener('sync', (event: SyncLike) => {
  if (event.tag === SYNC_TAG) event.waitUntil(syncOutbox());
});

worker.addEventListener('message', (event: MessageLike) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === 'SKIP_WAITING') void worker.skipWaiting();
});

serwist.addEventListeners();
