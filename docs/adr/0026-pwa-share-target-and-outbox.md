# 0026. PWA share target and encrypted outbox

## Status

Proposed

## Date

2026-10-23

## Context

[ADR 0009](0009-offline-pwa-serwist-dexie-indexeddb.md) chose Serwist and Dexie for the offline layer. Issue #50 makes the app installable and adds the Android share target: a lawyer shares a PDF, photo or voice note to CauseDeck from any app, and it must be saved on the device even with no network, then uploaded through the capture API (#43) when the connection returns.

## Decision drivers

- A share must never be lost: the files are written on the device before any network call.
- No tenant data in any browser cache, so a shared or stolen device shows nothing from the account.
- The service worker scope stays `/` without widening headers.
- The shell and court-day budgets hold: the worker is at most 60 KB gzip and Dexie and crypto load only on outbox routes.

## Considered options

1. `@serwist/next` with the webpack plugin. It does not serve the worker from the site root under Next 16 and Turbopack.
2. A prebuild step that bundles `app/sw.ts` with esbuild into `public/sw.js`.
3. Cache API storage for shared files. Rejected: the Cache API stores plain bytes.

## Decision

- Option 2. `lib/pwa/build-sw.ts` runs from `next.config.ts` for dev and build. The worker is served from `/sw.js` with `Cache-Control: no-cache` and no `Service-Worker-Allowed`, so its scope is `/`. Serwist supplies the routing and precache runtime.
- Caching: precache `/offline` and icons, network-first for HTML, cache-first for hashed `/_next/static` assets. `/api/*`, server actions and every tenant route are never cached (`lib/pwa/cache-policy.ts`).
- The worker takes the `POST /share-target`, writes each file to the Dexie outbox, then answers `303` to `/share-target?batch=<id>`. The page reads the outbox.
- Outbox blobs are encrypted with AES-GCM under a non-extractable `CryptoKey` kept in IndexedDB. This protects against reading the database file or a backup, not against code running in the origin or a person with an unlocked browser profile. The outbox stores no credentials or session tokens.
- The uploader runs presign, PUT and complete against `/api/captures` with the sha256 as the idempotency key, backs off with jitter up to 8 attempts, and deletes the blob when `complete` succeeds. A 200 MB cap (configurable) warns at 80% and blocks at 100%.
- Sync runs on Background Sync where available and on `online`, app open and `visibilitychange`. Data saver mode waits for an explicit "Upload now".
- Updates install in the background. During court-day windows (07:00 to 10:30 and 18:00 to 23:00 IST) the update never forces a reload and "Update now" is not offered.
- The manifest asks for no permissions; the Permissions-Policy still denies camera and geolocation. It allows the microphone for the app's own origin only (`microphone=(self)`), because the voice recorder (#543) asks for it when the person opens it; nothing records in the background.

## Consequences

- A signed-out share is stored and attributed to the session after sign-in; uploads always go through authenticated calls, so CSRF protection is unchanged.
- iOS has no Web Share Target, so it gets add-to-home-screen instructions and an "Upload files" button feeding the same outbox.
- The worker build is our own step; a Serwist upgrade does not change it.

## Revisit when

- `@serwist/turbopack` or an equivalent serves a root-scoped worker under Next without a prebuild step.
- Browsers expose a stronger on-device key store (for example hardware-bound keys for IndexedDB).

## Links

- [ADR 0009](0009-offline-pwa-serwist-dexie-indexeddb.md)
- [Technical architecture spike](../engineering/13-technical-architecture-spike.md) §1
