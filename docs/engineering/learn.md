# Practice school (`apps/site/src/learn`)

The free education program of D-049 (#511). Lessons are markdown files at
`apps/site/content/learn/<slug>/<locale>.md`, in English, Tamil and Kannada, parsed by
`apps/site/src/learn/index.ts` (no MDX dependency until the site has a renderer).

## Review workflow

- Front matter: `slug, locale, title, order, law, fixture, reviewer, reviewedOn`.
- Every lesson is reviewed by a practising advocate. Lessons with `law: true` show the ⚖ mark and
  are never published without that review.
- A lesson is **live** only when `reviewer` and `reviewedOn` (`YYYY-MM-DD`) are both set
  (`isLive`); the page shows the reviewer and the date (`reviewLabel`). Drafts ship with both empty:
  nobody fills them in except the reviewing advocate.
- Each lesson ends with the localized disclaimer: general education, not legal advice.

## Examples

Examples use only the fictional fixtures in `apps/site/src/learn/fixtures.ts`, each marked
`fictional: true` (invented names, numbers and 2031 dates). `learn.test.ts` rejects CNR, phone,
email and enrolment patterns. Nothing comes from a real matter.

## Signups

Each module links to `/sign-in?channel=education&module=<slug>`. `education` is a member of the
closed activation channel list (`packages/db/src/schema/activation.ts`).

## Signup channel (#703)

`/sign-in?channel=education&module=<slug>` is the door from a module page. The web proxy
(`apps/web/proxy.ts`) sets a short-lived (1 hour), httpOnly, `SameSite=Lax` `cd_channel` cookie on
`GET /sign-in` only when `?channel=` is a member of the closed `ACTIVATION_CHANNELS` list; anything
else is ignored, and the module slug is never stored. Magic-link, OAuth and phone-OTP flows create
the user in a later request, so the `user.create.after` hook in `packages/auth/src/server.ts` reads
the cookie from the request, validates it again against the closed list
(`packages/auth/src/signup-channel.ts`) and records it as `channel` on the `signed_up` activation
event (null when absent or invalid). Recording never fails a signup, and `@causedeck/auth` does not
depend on `@causedeck/core`.

## Progress for signed-in readers (#703)

Progress lives in the web app, because the site is static and has no session. `learn_progress`
(`packages/db/src/schema/learn-progress.ts`) holds one row per (user, module slug): user id, slug and
completion time, nothing else. It has no `workspace_id` (a reader's progress belongs to the person)
and is under FORCE row-level security keyed on `app.user_id` (`user_isolation`, `withUser`); the app
role may select, insert and delete, never update. The services in
`packages/core/src/activation/progress.ts` (`markLearnModuleDone`, `unmarkLearnModule`,
`listCompletedLearnModules`) validate the slug against `LEARN_MODULE_SLUGS`, which a test keeps equal
to `apps/site/src/learn/slugs.ts`. `/account` has a Practice school section (`#learn`) that lists the
modules with Done / Not done and a toggle backed by `setLearnModuleDoneAction`
(`apps/web/app/(app)/account/learn-progress-actions.ts`, self only). Strings are in
`settings.account.learn` in en, ta and kn.

## Not yet built

- A lesson renderer on the site (and a link from each progress row to its lesson). Modules stay
  not-live until a practising advocate fills in reviewer and date (#1044), so the account section says
  lessons are published after review and lets readers mark a module done in the meantime.
