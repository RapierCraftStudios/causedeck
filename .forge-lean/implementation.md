### Approach
The drafting package holds the registry of 12 system templates as data (block trees, semver, sha256 checksum, `reviewedBy` null). The db seeder takes entries as a parameter (db may not import drafting). A core script runs it as the owner after `db:migrate`. Exports of unreviewed templates print the scaffold banner and record `bannerShown` in the audit event.
### Changes
- packages/db: `template` gains `checksum`, `reviewed_by` and generated `is_system` (schema, migration, journal, snapshot); `seed/system-templates.ts` (checksum-gated upsert); package export.
- packages/validators: `client.name` resolver and `SystemTemplateSeedSchema`, with tests.
- packages/drafting: `Facts.client`, banner and locale render options (DOCX and PDF), generic preset, 12 templates and registry, `@causedeck/adapters` dependency, tests and snapshot.
- packages/core: `loadDraftFacts` fills `client.name` only from a `client`-kind person on the matter; export passes the banner and audits `bannerShown`; `system-templates.ts` glue; `scripts/seed-system-templates.ts`; tsconfig includes `scripts`; integration test.
- package.json (root, core): `db:migrate` chains the seed script; core gets `tsx`; pnpm-lock updated.
- packages/i18n: `drafting-templates` namespace (en, ta, kn), catalog, generated files, translation-status, guard test key list.
- docs/engineering/drafting-templates.md.
### Acceptance Criteria Status
- R1 ✅ packages/drafting/src/system-templates/index.ts:17, packages/db/src/schema/drafting.ts:55
- R2 ✅ packages/db/src/seed/system-templates.ts:46 (setWhere checksum)
- R3 ✅ packages/drafting/src/__tests__/system-templates.test.ts (snapshot)
- R4 ✅ packages/drafting/src/system-templates/common.ts:62
- R5 ✅ packages/core/src/drafting/service.ts (client.name), system-templates.test.ts
- R6 ✅ packages/core/src/drafting/export.ts (banner, bannerShown)
- R7 ✅ system-templates.test.ts citation lint
- R8 ✅ system-templates.test.ts phrase denylist
- R9 ✅ packages/drafting/src/render/docx.ts, system-templates.test.ts font test
- R10 ✅ packages/db/src/seed/__tests__/system-templates-seed.test.ts
- R11 ✅ packages/i18n/src/messages/*/drafting-templates.json
- R12 deferred (contract disposition), R14 post-deploy (contract disposition)
- R13 ✅ docs/engineering/drafting-templates.md
### Verification
- V1 drafting vitest: pass. V2 validators: pass. V3 db seed + rls: pass (seed test fails without the setWhere checksum gate: updated_at would change). V4 core drafting: pass. V5 i18n: pass. V6 checks.mjs: pass.
- `forgedock check`: PASS. tsc clean for drafting, db, core, i18n.
### Notes
`pnpm db:migrate` now also runs the core seed script (needs DATABASE_URL_OWNER). A re-seed with a changed checksum resets `reviewed_by` to null. The seed script itself was not run locally (the core `tsx` link needs an install).

## Sibling-list check
engine.test.ts:235 filters exports by /send|file|submit/i and expects []; SCAFFOLD_BANNER, SYSTEM_TEMPLATES, systemTemplate do not match, so recorded as not_members in result.json. No code change.

## CI lint fix
system-templates.test.ts: replaced `__dirname` with `fileURLToPath(new URL(..., import.meta.url))` (unicorn/prefer-module), used `re.source` in template literals (restrict-template-expressions), ran prettier. ESLint clean on all changed ts files in core, db, drafting, validators, i18n; the 19 system-templates tests pass.

## CI lint fix
CI lint log was unavailable. Prettier flagged 9 system-template files; reformatted them and untracked the accidentally committed packages/drafting/.eslintcache. ESLint on changed files is clean; system-templates test passes.

## CI fix attempt
CI log was unavailable and every locally runnable check passes. DB-backed tests could not run here (no Postgres). Only a stale comment in the seed test was corrected; the failing test is unidentified.

## CI fix: memory-erasure timeout
The only failure was `src/lifecycle/__tests__/memory-erasure.test.ts` timing out at 60 s in the core shard (collect 580 s, so the runner was heavily loaded). The file is untouched by this branch and no code in it touches `template`. It passes locally in 1.5 s (4/4). Treated as a load flake: no code change, so a CI rerun is the fix.

## Merge fix: typecheck exit 127
`turbo: command not found` was an environment/PATH failure, not a code conflict from the merge. No code change. `pnpm exec turbo run typecheck` over drafting, core, db, validators and i18n (plus dependencies) passes: 17/17 tasks.

## Merge fix: typecheck exit 127 (repeat)
Same cause: `turbo` was not on PATH in the check shell, so it is not a code conflict. No source change. `pnpm exec tsc --noEmit` passes in drafting, validators, db, core and i18n.

## Merge fix: typecheck exit 127 (third time)
Still `turbo: command not found` in the check shell (PATH), not a code conflict. No source change. `./node_modules/.bin/turbo run typecheck` over drafting, db, validators, i18n, core passes: 17/17 tasks. The check command needs `pnpm exec turbo` or node_modules/.bin on PATH.
