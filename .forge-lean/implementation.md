### Approach
Markdown lessons with a hand-parsed front-matter block (no new dependency; apps/site has no MDX or Next stack yet). A lesson is live only when a reviewer and a review date are set; the committed drafts carry neither, so no reviewer is invented. Examples use fictional fixtures copied in shape from core's golden fixtures. Signup links carry the closed `education` channel, added to the activation channel list through a migration.

### Changes
- apps/site/src/learn/{slugs,index,fixtures,signup-link}.ts: module registry, loader and parser, `isLive`, `reviewLabel` (⚖ for law modules), fictional fixtures, `signupHref`.
- apps/site/content/learn/<slug>/{en,ta,kn}.md: 6 modules x 3 locales, each ending in the localized disclaimer.
- apps/site/src/learn/learn.test.ts: regression tests (modules, review gate, fictional-only fixtures, signup links).
- packages/db/src/schema/activation.ts: `education` added to `ACTIVATION_CHANNELS`.
- packages/db/migrations/20261025020000_education_channel.sql plus meta snapshot and journal: recreates `activation_event_channel_chk`.
- apps/admin/__tests__/growth-page.test.tsx, packages/core/src/activation/activation.test.ts: channel list mock and an `education` channel test.
- docs/engineering/learn.md: review workflow.

### Acceptance Criteria Status
- R1 ✅ apps/site/src/learn/index.ts:84; apps/site/content/learn/ (18 files)
- R2 ✅ apps/site/src/learn/fixtures.ts:1
- R3 ✅ apps/site/src/learn/signup-link.ts:8
- R4 deferred (amendment)
- R5 ✅ apps/site/src/learn/index.ts:37-48; docs/engineering/learn.md
- R6 post-deploy (contract): reviews by a practising advocate are human; modules stay not-live until filled in
- R7 ✅ apps/site/src/learn/learn.test.ts (fictional fixtures describe)
- R8 ✅ apps/site/src/learn/signup-link.ts:8; packages/db/src/schema/activation.ts
- R9 deferred (contract)
- R10 ✅ disclaimer in every apps/site/content/learn/*/*.md; learn.test.ts

### Verification
- V1 site vitest (learn, index, developer-docs): pass (9 tests). The new learn tests fail without the change (module absent).
- V2 core activation test: pass (new education-channel test fails without the schema change: the CHECK rejects `education`).
- V3 admin growth-page test: pass.
- V4 db index test: pass.
- V5 site tsc --noEmit: pass. `drizzle-kit check` and migration lint pass; eslint on changed files passes (pre-commit hook).
- forgedock check: PASS.

### Notes
- Migration is timestamp-named and later than the base's latest (journal `when` is above the previous entry's, so already-migrated databases apply it).
- Nothing is live yet: `liveModules()` is empty until advocates fill in `reviewer` and `reviewedOn`.
- The channel is not recorded at signup for any source (packages/auth/src/server.ts:547-552); that is the deferred R9.

### Stale-list follow-up
- The seven flagged tests matched `learn` only through the docs/engineering path. None lists docs files or site modules, and no i18n namespace or core export was added, so each is recorded in result.json `not_members`; no test lists changed.
