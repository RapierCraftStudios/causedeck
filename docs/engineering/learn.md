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

## Not yet built

- Progress tracking for signed-in users (needs auth and a per-user table).
- Recording the channel at signup (`packages/auth/src/server.ts` stores none for any source), which
  the funnel needs to attribute education signups.
