# Offline court-day: manual test matrix (#65, #747)

Playwright (`e2e/tests/product/offline-court-day.spec.ts`) covers Chromium with offline emulation.
It cannot cover iOS Safari or real Android networking, so each release that touches the offline
store, the service worker or the prefetch is checked by hand on the devices below. ADR:
[0042](../adr/0042-offline-encrypted-store-and-key-lifecycle.md). Use the seeded `chennai-solo`
workspace, or a real chamber with at least one listing today and tomorrow.

| Device / OS            | Browser           | Mode                  |
| ---------------------- | ----------------- | --------------------- |
| iPhone, current iOS    | Safari            | In the browser tab    |
| iPhone, current iOS    | Safari            | Added to Home Screen  |
| Android phone, current | Chrome            | In the browser tab    |
| Android phone, current | Chrome            | Installed (standalone) |
| Android phone, one major version back | Chrome | Installed          |

## Cases (run each on every row; record Pass / Fail / n.a. and the build)

1. **Prefetch.** Sign in on Wi-Fi, open Today, wait 30 s. Settings, Privacy, Offline card shows
   saved days and a non-zero cache size.
2. **Offline Today and Tomorrow.** Airplane mode on, open Today then Tomorrow from the app. The
   saved board shows, with the "saved at" time in the banner (warning tone, never red).
3. **Offline brief.** From the offline board open a brief. It renders from the saved copy.
4. **Uncached route.** Offline, open Matters. The branded offline page shows with a way back.
5. **Reconnect.** Airplane mode off. The banner clears and a "Back online" toast shows; sync
   status returns to idle.
6. **Outbox replay.** Offline, tick a carry item and edit a note; reconnect. Each change lands once,
   in order; nothing is duplicated. A next-date edit made offline shows a conflict card when the
   server value changed.
7. **Revoked access.** Remove the member's access to a matter on another device; reconnect here.
   The matter's saved brief is gone after the next sync.
8. **Isolation.** Sign out, sign in as another member (and another workspace) on the same device.
   The first member's saved days are not shown offline.
9. **Storage pressure.** Fill storage (iOS: Low Storage; Android: Storage settings). The storage
   meter and "storage full" notice show; saved briefs are kept over documents.
10. **iOS 7-day eviction.** In the Safari tab, leave the site unused for 7 days. Reopen online: the
    store is empty and the prefetch refills it (Safari may delete script-written storage after 7
    days without a visit; the Home Screen app is exempt).
11. **Accessibility.** With VoiceOver (iOS) or TalkBack (Android), going offline announces the
    banner once; focus order on the offline board reaches every brief link.
12. **Reduced motion.** With reduced motion on, no banner or sync animation plays.

Record results in the release checklist; a Fail on any row blocks the offline claim in release notes.
