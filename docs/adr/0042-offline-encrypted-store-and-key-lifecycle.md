# 0042. Offline encrypted store and key lifecycle

## Status

Proposed

## Date

2026-10-25

## Context

PRD offline work (#65) keeps the next few days of court days and briefs on the device so an advocate can read them in a court hall with no signal. Those rows carry party names, case titles and private notes. [ADR-0009](0009-offline-pwa-serwist-dexie-indexeddb.md) chose Dexie on IndexedDB, and [ADR-0026](0026-pwa-share-target-and-outbox.md) added an outbox sealed under a non-extractable device key that survives sign-out so queued captures are never lost.

Threat model, the lost phone: someone with the unlocked or rooted device, a browser-profile copy or a backup can read IndexedDB. They do not hold the advocate's session. We want the cache to be unreadable without a signed-in session, to disappear when the advocate signs out, switches workspace or clears it, and to hold nothing beyond a short rolling window. We cannot defend against malware running inside the signed-in browser, or against an unlocked device in the hand of the thief while the session is live; the device lock remains the primary control.

## Decision drivers

- Party names never sit in IndexedDB in the clear.
- Sign-out must make cached data unreadable, unlike the outbox.
- One user or workspace on a shared browser never reads another's rows.
- Keep Dexie confined to one module so the shell stays light.

## Considered options

| Option                                                     | Verdict  | Reason                                                                                  |
| ---------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Random data key, wrapped by a key derived from the session | Chosen   | Destroying the wrapped key or losing the session makes rows unreadable                  |
| Reuse the #50 device key for the cache                     | Rejected | Device-bound and kept across sign-out by design; a signed-out phone would stay readable |
| Plaintext rows, rely on the device lock                    | Rejected | A profile copy or backup exposes party names                                            |
| Delete the cache only (no encryption)                      | Rejected | Deletion can fail (crash, force-quit); sealed rows stay safe                            |

## Decision

- `apps/web/lib/offline/db.ts` holds one Dexie database per user and workspace (`causedeck-offline:<userId>:<workspaceId>`) with stores `courtDay` (`[workspaceId+date]`), `briefs` (`[workspaceId+listingId]`), `documentsMeta`, `outbox` and `meta`. Only keys, the day, `savedAt` and ids are in the clear; every payload is `{ iv, data }` sealed with AES-GCM and a fresh 96-bit IV.
- `crypto.ts` generates a random 256-bit data key, wraps it with an AES-GCM key derived by HKDF-SHA-256 from a secret that exists only for the signed-in session, and stores only the wrapped form in `meta`. The working key is imported non-extractable.
- The wrapped key and the database are deleted on sign-out (every scope), workspace switch (the left scope) and the "clear saved data" action. A different session secret cannot unwrap the key.
- `freshness.ts` stamps `savedAt`, flags data older than 24 hours as stale, and keeps a rolling window: days from yesterday onward stay, older days and briefs are evicted.
- Relation to the #50 key: separate keys and databases. The outbox key stays device-bound and survives sign-out; the cache key does not. The outbox rows `lib/offline` declares are for replayed offline edits (#745), not captures.
- The offline i18n keys live in the `offline` namespace, which absorbs the earlier `offline.title` and `offline.body` from `errors.json`.

## Consequences

- Positive: signing out leaves no readable court data; a copied profile yields ciphertext.
- Negative: the first load after sign-in has no cache until the next sync; a new sign-in cannot read a previous session's rows (they are deleted at sign-out, and a failed unwrap means "no cache").
- Accepted: while the session is live and the device unlocked, the data is readable; the key sits in memory.

## Revisit when

- Browsers offer hardware-bound keys that survive the session (see ADR-0026).
- A server-issued per-session secret replaces the client-supplied one.
- The window grows beyond a week or documents themselves are cached.
