# 0009. Offline PWA with Serwist and Dexie on IndexedDB

## Status

Accepted

## Date

2026-10-18

## Context

Court halls often have poor connectivity, and the PWA is the mobile client (D-036; native Expo is deferred). A lawyer needs the 7-day court-day view and briefs offline, and captures (photos, voice notes, shared files) must not be lost. Android share-sheet capture is a core flow. The spike fixes this in [§1](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (Offline / PWA row) and in the [§3.2](../engineering/13-technical-architecture-spike.md#32-scale-path-designed-in-from-day-one) Stage C row (PowerSync later).

## Decision drivers

- Read the court day and briefs offline. Queue captures offline and send them later.
- Capture from the Android share sheet without a native app.
- No additional sync backend or service at bootstrap.

## Considered options

| Option                                                      | Verdict  | Reason                                                                            |
| ----------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| Serwist service worker + Dexie (IndexedDB) cache and outbox | Chosen   | Works with the Next.js App Router; Web Share Target; no extra backend             |
| PowerSync (or a similar Postgres sync engine) now           | Rejected | Deferred: a sync service and per-workspace sync rules are more than Stage A needs |
| Native Expo app                                             | Rejected | Deferred by D-036 (supersedes D-008); a second client to build and ship           |
| next-pwa / Workbox only, no IndexedDB                       | Rejected | The HTTP cache alone cannot hold structured data or an outbox                     |

## Decision

- `apps/web` is an installable PWA with a **Serwist** service worker and a **Web Share Target** for Android share-sheet capture.
- **Dexie on IndexedDB** caches the 7-day court-day view and briefs, and holds an **outbox** for captures that are sent when the device is online.
- **PowerSync is deferred.** It is a later scale option (spike §3.2 Stage C) and is not in bootstrap.

## Consequences

- Positive: the core court-day flow works offline with no new backend.
- Negative: offline data is a read cache plus an append-only outbox, not two-way sync. Edits to existing records need a connection.
- Negative: cached tenant data on the device must be cleared on sign-out and on workspace switch.

## Revisit when

- Spike §3.2 Stage C trigger: > 10k seats or several teams. PowerSync then provides richer offline.
- Lawyers need offline edits beyond captures (for example from validation findings), or iOS PWA limits block a core flow.

## Links

- [Spike §1](../engineering/13-technical-architecture-spike.md#1-stack-decisions)
- [DECISIONS.md](../../DECISIONS.md) D-036
