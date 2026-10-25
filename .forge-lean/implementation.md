### Approach
Mirror the push channel. A new `createWhatsAppSender` (Meta Cloud API, injectable `fetch`) is built from env and is `undefined` when the provider env is absent, so delivery is recorded as skipped. The sender only takes a target resolved by the caller. `notification.deliver` resolves it with `getWhatsAppSendTarget` (the owner's verified, consented number, category chosen), and the end-of-day digest does the same for its own summary. `@causedeck/notifications` never imports core, so the lookup stays in the jobs.

### Changes
- packages/notifications/src/channels/whatsapp.ts, channels/index.ts: sender, template registry (`court.board`, `status.order`, `digest.end_of_day`), E.164 re-check, permanent vs retryable errors; `./whatsapp` export in package.json.
- packages/notifications/src/service.ts: `DeliveryJob.channel` includes whatsapp; `notify()` fan-out includes whatsapp for opted-in preferences (no category defaults it on).
- packages/core/src/jobs/definitions/notification-deliver.ts: `whatsapp` in `DELIVERY_CHANNELS`, deps and branch (skips `whatsapp_disabled`, `no_template`, `not_linked`, `quiet_hours`; permanent 4xx recorded failed).
- packages/core/src/jobs/definitions/activity-digest.ts: evening WhatsApp summary (counts and link), after the email, never in court hours, failure logged not retried.
- packages/core/src/jobs/definitions/news-digest.ts: widen a local `channel` type (needed to typecheck; amendment).
- packages/config/src/env/schema.ts, .env.example, docs/engineering/env.md: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION`, set-together check.
- packages/config/eslint/core-domains.js, docs/engineering/core-domains.md: `jobs --> whatsapp-link`.
- docs/engineering/notifications.md: channel docs.
- Tests: channels/__tests__/whatsapp.test.ts, notification-deliver.test.ts, activity-digest.test.ts, config schema.test.ts.

### Acceptance Criteria Status
- R1 ✅ packages/notifications/src/channels/whatsapp.ts:100
- R2 ✅ packages/core/src/jobs/definitions/notification-deliver.ts:85, activity-digest.ts (sendWhatsAppSummary), notifications/src/service.ts fan-out
- R3 ✅ packages/config/src/env/schema.ts (WHATSAPP_*)
- R4 ✅ notification-deliver.test.ts "sends only to the verified number of the notification owner, once"; whatsapp.test.ts "refuses a target that is not an E.164 number"
- R5 deferred (human residency review, #488)

### Verification
- V1 notifications vitest (channels, index, push): pass. The new channel tests fail without the fix (module absent).
- V2 core vitest (notification-deliver, activity-digest, domains): pass, 40 tests; the new whatsapp tests fail without the fix.
- V3 config vitest: pass, 296 tests.
- V4 checks.mjs: ran (widened because of a package.json change); instead tsc --noEmit on notifications, config and core is clean, and eslint on changed files is clean (lint hook passed on commit). `lane-check.sh` does not exist on this host.

### Notes
- New env vars: `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` (together; absent = WhatsApp disabled), optional `WHATSAPP_API_VERSION` (default v21.0). Provider assumed to be the Meta Cloud API; template names `causedeck_court_board`, `causedeck_status_order`, `causedeck_end_of_day` must be approved with the provider.
- Behaviour: members with a whatsapp preference row on now enqueue `notification.deliver` for it; with no provider env those are recorded as skipped.
