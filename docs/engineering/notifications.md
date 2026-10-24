# Notifications

`@causedeck/notifications` (#23) tells workspace members about their own workspace: in the app
(the bell and panel), by email and by Web Push. Delivery runs as pg-boss jobs in
`@causedeck/core/jobs`. Notifications go only to authenticated, active members of the workspace
they are about. Nothing is ever sent to clients, parties or any other third party, and there is no
marketing email.

```sh
pnpm --filter @causedeck/notifications test             # service, templates, push (test database)
pnpm --filter @causedeck/notifications test:tenancy     # cross-tenant suite
pnpm --filter @causedeck/notifications vapid:generate   # a VAPID key pair for .env
```

## Layout

| Path                                                   | What                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema/notifications.ts`              | Tenant tables `notification`, `notification_pref`, `notification_setting`; global `push_subscription`, `email_suppression` |
| `packages/notifications/src/categories.ts`             | Category registry, channels, digest modes (`/categories`, client-safe)                                                     |
| `packages/notifications/src/service.ts`                | `notify`, list/read, preferences and settings (`.`)                                                                        |
| `packages/notifications/src/quiet-hours.ts`            | Court hours and `isQuietTime` (`/quiet-hours`, client-safe)                                                                |
| `packages/notifications/src/email/`                    | Transports (SES, SMTP, console), React Email templates, suppression                                                        |
| `packages/notifications/src/push/`                     | VAPID config, subscribe/revoke, send (`/push`)                                                                             |
| `packages/core/src/jobs/definitions/notification-*.ts` | `notification.deliver` and the daily digest jobs                                                                           |
| `apps/web/app/(app)/w/[slug]/notifications/`           | Bell and panel server actions (#198)                                                                                       |
| `apps/web/app/(app)/w/[slug]/settings/notifications/`  | Preferences page, form and server actions (#199)                                                                           |
| `apps/web/app/(app)/settings/notifications/`           | Workspace-less redirect used by email footers                                                                              |
| `apps/web/app/api/push/{subscribe,unsubscribe}`        | Push subscription endpoints (#197)                                                                                         |

## Categories

Every notification has exactly one category from `CATEGORIES`. A category sets its default
channels, whether it is `mandatory`, and which `lockedChannels` the member cannot turn off.

| Category           | Default channels    | Locked        |
| ------------------ | ------------------- | ------------- |
| `workspace.invite` | in-app, email       |               |
| `member.joined`    | in-app              |               |
| `security.alert`   | in-app, email, push | in-app, email |
| `billing.notice`   | in-app, email       |               |
| `reminder.hearing` | in-app, email, push |               |
| `court.board`      | in-app, push        |               |
| `proposal.new`     | in-app, push        |               |
| `digest.daily`     | email               |               |
| `system.notice`    | in-app              |               |

To add a category:

1. Add it to `CATEGORIES` in `categories.ts`.
2. Add `notifications.preferences.categories.<camelCaseKey>.{label,description}` in en, ta and kn,
   and map it in `CATEGORY_MESSAGE` in `preferences-form.tsx`. next-intl keys cannot contain dots,
   so `reminder.hearing` becomes `reminderHearing`.
3. If it needs its own email, add a template in `email/templates/` and pick it in `renderFor`
   (`notification-deliver.ts`). Otherwise it uses `notice`.
4. Add a generic push title to `GENERIC_PUSH_TITLES` (`push/payload.ts`).

## Preferences

`notification_pref` holds one row per (workspace, member, category, channel) with `enabled` and
`digest` (`instant | daily | off`). Absent rows fall back to the category defaults. `resolve()` in
`service.ts` applies this order:

1. A locked channel is always enabled and `instant`, whatever the rows say.
2. Otherwise the member's row is used.
3. Otherwise the category default applies (enabled when the channel is in `defaultChannels`, digest
   `instant`).

`setPreference` refuses to disable a locked channel, or move it off `instant`, with `VALIDATION`.

What each value does:

- In-app off hides the category from the bell list and the unread count (`listForUser`,
  `unreadCount`). Rows are still written.
- `notify()` enqueues `notification.deliver` for email and push only when the channel is enabled
  and `instant`. The job checks again when it runs, so a change made after enqueueing still applies.
- Email with `daily` waits for the digest. `off` never sends.

### The digest selector

The preferences page has one control, `Instant / Daily at 6:30 pm / Off`, and no `digest.daily`
row. `setDigest` applies the choice in one transaction:

| Choice    | Unlocked email rows (all categories except `digest.daily`) | `digest.daily` email |
| --------- | ---------------------------------------------------------- | -------------------- |
| `instant` | `digest = instant`, on/off kept                            | off                  |
| `daily`   | `digest = daily`, on/off kept                              | on                   |
| `off`     | `digest = off`, on/off kept                                | off                  |

Locked channels (`security.alert` email), in-app and push rows are never written. `getDigest`
reads back the mode those email rows share, or `instant` when they differ.

### Settings

`notification_setting` holds one row per member and workspace. No row means every setting is off.

- **`court_hours_quiet`** (`Do not push during court hours`) makes 10:30-17:00 in the
  workspace time zone quiet (`COURT_HOURS`, `isQuietTime`). Inside that window:
  - the daily digest is skipped (`skippedQuiet`);
  - push is skipped as `quiet_hours` (the in-app row stays).
  Setter: `setCourtHoursQuiet`.
- **`lock_screen_details`** (`Show details on lock screen`): when off, a push carries only a generic
  title (`GENERIC_PUSH_TITLES`) and a link, never matter names, party names or document text. When
  on, it carries the notification's title and body. Setter: `setLockScreenDetails`.
- **`bench_alert_party_names`** (#389): bench-change alerts (`detectBenchChanges`,
  `@causedeck/core/court`, category `reminder.hearing`) say only how many matters changed bench and
  from when ("2 matters have a bench change from 05 Oct"). When on, the body also lists the
  proceedings' parties (`petitioner v respondent`). Setter: `setBenchAlertPartyNames`. It is not
  part of `NotificationSettings`; the core service reads the column directly.

The time zone is the workspace's (`workspace_settings.timezone`, default `Asia/Kolkata`). Members
have no time zone of their own.

## Jobs

**`notification.deliver`** (`{ workspaceId, notificationId, channel }`) re-reads the row, the
member and their preference, then:

- Skips, and records the reason in `notification.data.delivery.<channel>`, when the member left,
  the channel is off or not instant, the email address is suppressed, push is disabled (no VAPID
  keys), the member has no subscription, or it is court hours.
- Sends once: the singleton key stops duplicate jobs and `once()` stops a redelivered job from
  sending again.
- Records a permanent email failure as `failed`. Retries anything else with backoff (5 attempts).

**`system.notification.digest`** runs every half hour in `Asia/Kolkata` and enqueues
**`notification.digest`** for each workspace whose local time is in the 18:30 slot. The digest:

- emails each member who has the `digest.daily` email on;
- lists their `daily` email notifications since the previous 18:30;
- is skipped when there is nothing to report, during quiet hours, or for a suppressed address.

Each member gets one digest a day.

## Push

The server sends with `web-push` and the VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`). Without keys, push is disabled. The permission prompt only follows a click on
`Turn on` (`PushPermissionCard`). Subscriptions are per user and global. A 404 or 410 from the push
service revokes the subscription.

## Email

`EMAIL_PROVIDER` selects the transport: `console` (default), `ses` (ap-south-1) or `smtp`
(Mailpit in dev). Templates are React Email with a plain-text alternative, no remote images and no
tracking. Non-mandatory emails link to `<APP_URL>/settings/notifications` (`preferencesUrl`). That
route sends a signed-in member to `/w/<landing workspace>/settings/notifications`, a member without
a workspace to `/onboarding`, and a signed-out visitor to `/sign-in?next=/settings/notifications`.
Bounces and complaints add the address to `email_suppression`, and it is never emailed again.

## Preferences page

`/w/[slug]/settings/notifications` loads `getPreferences`, `getDigest` and
`getNotificationSetting` for the signed-in member on the workspace transaction. Layout:

- From 768 px, a category × In-app/Email/Push matrix of switches.
- Below 768 px, one card per category.
- Locked channels are checked and disabled, with a lock and the explanation.

Each change saves at once through a server action (`setNotificationPreferenceAction`,
`setNotificationDigestAction`, `setCourtHoursQuietAction`, `setLockScreenDetailsAction`) and rolls
back if the save fails. The actions run through `workspaceAction` and always act for the signed-in
user. Their input never names a user. Strings are `notifications.preferences.*` in en, ta and kn.

## Tenancy and tests

Every service opens `withWorkspace` and first checks that the user is an active member
(`FORBIDDEN` otherwise). Row-level security isolates workspaces. Each service is registered in
`NOTIFICATION_SERVICE_TESTS` (`packages/db/src/testing/cross-tenant-registry.ts`) with a case in
`packages/notifications/src/__tests__/cross-tenant/services.test.ts`. Every web action is listed in
`apps/web/__tests__/cross-tenant-actions.test.ts`.

| Test                                                        | Covers                                      |
| ----------------------------------------------------------- | ------------------------------------------- |
| `packages/notifications/src/__tests__/service.test.ts`      | notify, preferences, digest, court hours    |
| `packages/core/src/jobs/definitions/notification-*.test.ts` | delivery, quiet hours, digest               |
| `apps/web/__tests__/notification-preferences*.test.ts(x)`   | page, form, actions, copy                   |
| `e2e/tests/notifications/{bell,push,preferences}.spec.ts`   | bell and panel, push subscribe, preferences |
