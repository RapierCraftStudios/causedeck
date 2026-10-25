**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield GTM feature; milestone Instant GTM & Adoption)
**Task Type**: feature

(The `.forge-lean/*` files left in this worktree described #501 and were stale; they are replaced. Verified against HEAD 3f3d449c, which equals `origin/milestone/instant-gtm-adoption`.)

### What Was Claimed
A free practice school for juniors and law students, en/ta/kn, under `apps/site/src/learn/`: at least 6 reviewed and dated modules, interactive examples on fictional fixtures only, signup prompts into the free alerts tier (#506), progress tracking for signed-in users, a per-module advocate review workflow, a legal disclaimer, and module-page signups tracked in the activation funnel (#509).

### What We Found
- No education surface: `apps/site/src/` holds only `index.ts` (a stub constant) and tests; no `learn/` directory (`apps/site/src/index.ts:2`).
- `apps/site` is not a Next app yet: `apps/site/package.json:7` build is a stub and there is no `next`, React or MDX dependency. Its precedent for content is plain markdown under `apps/site/content/developers/api.md`, guarded by `apps/site/src/developer-docs.test.ts:1-40` (reads the file with `node:fs`).
- Locales are closed: `packages/i18n/src/locales.ts:4` (`en`, `ta`, `kn`); message catalogs live in `packages/i18n/src/messages/{en,ta,kn}`.
- Fictional fixtures exist for reuse: `packages/core/src/import/fixtures/bundles.ts:1-3` (synthetic advocates, no real data) and `packages/intelligence/src/generic-a0/synthetic/generate.ts`. `apps/site` does not depend on those packages.
- Funnel: `packages/db/src/schema/activation.ts:25-49` has a closed `ACTIVATION_STEPS` list and `ACTIVATION_CHANNELS` (`direct, invite, whatsapp, search, social, referral, other`; no education value), enforced by the CHECK `activation_event_channel_chk` (`:67-70`), created in `packages/db/migrations/20261024182641_activation_event.sql`.
- Signup never records a channel: `packages/auth/src/server.ts:547-552` inserts `signed_up` with no channel, and `apps/web` has no code that sets one. The admin growth page filters by channel (`apps/admin/app/(console)/growth/page.tsx:33`).
- #506 (free alerts tier) is still OPEN; #501 and #509 are closed and merged.
- D-049 (`DECISIONS.md:394`) names "Education (Varsity)" as "The practice education program" and says it is a GTM lever. No decision text yet on disclaimers or review.

### Root Cause
Greenfield: nothing exists. The site package is a placeholder with no rendering stack, so a design choice is needed (see Recommendation).

### Affected Files
- New `apps/site/src/learn/` (module registry, loader/validator, fixtures, signup-link helper, tests) and `apps/site/content/learn/<slug>/{en,ta,kn}.md`.
- `packages/db/src/schema/activation.ts` plus a new timestamp-named migration and regenerated snapshot/journal (add channel `education`).
- `packages/core/src/activation/activation.test.ts`, `apps/admin/__tests__/growth-page.test.tsx:23` (hard-coded channel list mock).
- `docs/engineering/` content-review doc (new, short).

### Sibling Sweep
- Other closed enums mirrored by hand: the admin growth test mock (`growth-page.test.tsx:23`) and any i18n label for channels in the admin page; check on implementation with `grep -rn "'referral'"`.
- `apps/site/content/developers/api.md` is the one existing content pattern; the learn guard tests should follow `developer-docs.test.ts`.

### History
`apps/site` was created as a scaffold; `content/developers` was added with the public API docs. `activation_event` landed in #509 (migration `20261024182641`). No prior attempt at the learn surface; earlier #511 runs in the issue comments ended in engine errors (HTTP 502) with no code.

### Recommendation
Build it without new dependencies: markdown (front matter parsed by a small TS loader, validated by tests) rather than MDX; the loader returns typed modules so a later Next/MDX renderer can consume them. Six modules x three locales, each with front matter `slug, title, locale, order, law (bool), reviewer, reviewedOn, sources`. A module is "live" only when it has a reviewer and date; no reviewer name is invented, so every module ships unreviewed and the review step stays human. Examples use inline fictional fixtures with a unit test rejecting real-looking data (fixture marker, CNR/enrolment patterns not on an allowlist). Disclaimer is a required footer per locale. Signup CTA links to `/sign-in?channel=education&module=<slug>`. Add channel `education` via migration. Defer: signed-in progress tracking (needs auth and a table in a static site), capture of the channel at signup (no channel is captured for any source today), and the actual advocate reviews and Tamil/Kannada review (human).

### Related Issues
#501 (closed, dependency), #506 (open, free alerts tier; link target only, no code dependency), #509 (closed, funnel), D-049.
