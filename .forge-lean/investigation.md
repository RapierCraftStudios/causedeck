**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature; no live defect)
**Task Type**: feature

### What Was Claimed
Part 2 of #502: a WhatsApp Business outbound channel (`packages/notifications/src/channels/whatsapp.ts`: provider client, approved templates, send only to the verified linked number, per-user consent, quiet hours, court-hours rules), wired into `notification.deliver` (`DELIVERY_CHANNELS`), the evening summary (`digest.end_of_day`), `court.board` and `status.order` alerts. Provider env config. Unit test: never a message to a number other than the verified user's.

### What We Found
- Dependency #678 is CLOSED and merged (HEAD 7cb370dd): `packages/core/src/whatsapp-link/link.ts:295` `getWhatsAppSendTarget(deps, actor, {category})` returns the owner's verified `{e164}` or null (non-member, no link, category not chosen). `whatsapp_link.categories` and `consent_at` are in `packages/db/src/schema/whatsapp-link.ts:29-32`. The earlier "Investigation Report" comment on #679 describes #678, is stale.
- `packages/notifications/src/categories.ts:6` `CHANNELS` already has `'whatsapp'`; the enum is already extended. But `categories.ts` `court.board`/`status.order`/`digest.end_of_day` default channels do not include whatsapp (a pref row must opt in; `resolve` at `service.ts:176-186`).
- `packages/notifications/src/service.ts:49-50` `DeliveryJob.channel` excludes `whatsapp` ("sender arrives with #679"); `service.ts:240` fan-out is hard-coded `['email','push']`.
- `packages/core/src/jobs/definitions/notification-deliver.ts:81` `DELIVERY_CHANNELS = ['email','push']`; the handler branches email vs else-push (`:200-240`), `channelEnabled` (`:150`), push quiet hours via `notification_setting.courtHoursQuiet` + `isQuietTime/localMinutes` (`:221-229`), `NotificationJobDeps` (`:90-96`) built from `serverEnv()` (`:105-117`). Also exported from `jobs/index.ts:109`, and listed in `packages/db/src/testing/cross-tenant-registry.ts:1271` (`DELIVERY_CHANNELS: 'constant'`).
- `digest.end_of_day` is skipped by the generic job (`notification-deliver.ts:~186` `own_email`); the digest job (`activity-digest.ts:273-285`) calls `notify` with a no-op `enqueueDelivery`, so the evening summary needs its own WhatsApp send there (after `buildEndOfDayDigest`, inside `once()`).
- No `packages/notifications/src/channels/` dir, no provider env keys (`packages/config/src/env/schema.ts:170-195` has only VAPID as the analogue; also `.env.example`, `docs/engineering/env.md`). `@causedeck/notifications` must not import `@causedeck/core` (core depends on it), so the target lookup is injected into the channel.
- `packages/config/eslint/core-domains.js:138` `jobs` allow-list does not include `whatsapp-link`; jobs must import it via its `index.ts` (and `docs/engineering/core-domains.md` jobs edges ~l.165).
- Court hours: `packages/notifications/src/quiet-hours.ts:5` 10:30-17:00; `court.board` alerts are in-court-day alerts, so "court-hours rules" = respect `courtHoursQuiet` (as push does) and never send the evening summary inside court hours.

### Root Cause
Missing feature: #678 stored consent and the verified number but nothing sends to it.

### Affected Files
- packages/notifications/src/channels/whatsapp.ts (new), channels/index.ts (new), package.json export `./whatsapp`, tests in `channels/__tests__/`
- packages/notifications/src/service.ts, categories.ts (+ tests)
- packages/core/src/jobs/definitions/notification-deliver.ts, activity-digest.ts, jobs/index.ts, their tests
- packages/config/src/env/schema.ts, .env.example, docs/engineering/env.md, docs/engineering/notifications.md
- packages/config/eslint/core-domains.js, docs/engineering/core-domains.md
- packages/db/src/testing/cross-tenant-registry.ts (only if exports change)

### Sibling Sweep
Same shape as push (`notifications/src/push/send.ts`, injected `PushSender`, absent config = skipped). Places enumerating channels: `CHANNELS`, `DELIVERY_CHANNELS`, `DeliveryJob`, service fan-out `['email','push']` (checked by grep). `news-digest.ts` and `notification-digest.ts` also run channel logic; check they do not iterate DELIVERY_CHANNELS.

### History
Channel enum and link service from #678 (merge 7cb370dd). Push channel #197 is the pattern. #502 closed not_planned and split into #678-#681.

### Recommendation
Single lane. Build `createWhatsAppSender({env, log, fetch?})` mirroring PushSender: absent env -> undefined (job records `whatsapp_disabled`); a template registry (template name per category, positional params, content-minimal, locale); `send(message, target)` takes the target resolved by the caller only. Job: add `'whatsapp'` to `DELIVERY_CHANNELS`, deps `whatsapp?`, branch: check channelEnabled, resolve `getWhatsAppSendTarget({db}, {userId, workspaceId}, {category})` (null -> skip `not_linked`), apply court-hours quiet, send inside `once()`; permanent provider 4xx -> failed, else RetryableError. `notify()` fan-out adds whatsapp for opted-in prefs (extend `DeliveryJob`). Add `whatsapp` to defaultChannels? No: opt-in only (consent), enabled by `setWhatsAppCategories`/prefs. Evening summary: in `runActivityDigestMember`, send template when whatsapp pref on, target present, outside court hours. Provider env: `WHATSAPP_API_URL`? Use Meta Cloud API: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (secret), both-or-none `requiredWhen`.

### Related Issues
#502 (parent), #678 (done), #680, #681 (siblings), #488 (residency review, human, not blocking).
