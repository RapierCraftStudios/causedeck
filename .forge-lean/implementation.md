### Approach
Resumed from the checkpoint: the status domain, tables, job, storage seam, env and registries were in place. I added the missing core test suite and the i18n `status` namespace, and fixed an idempotence bug in `publishStatus`. The new snapshot was compared with its signature included, so every run counted as "changed".

### Changes
- packages/core/src/status/publish.ts: compare unsigned content on both sides (idempotent publish); lint fixes.
- packages/core/src/status/status.test.ts: schema, thresholds, sanitiser, signature, idempotent publish, stale and court wording tests.
- packages/i18n/src/catalog.ts, messages/{en,kn,ta}/status.json, generated/**, __tests__/catalog.test.ts: `status` namespace.
- Earlier checkpoint: tables, migration, job, storage key seam, env, registries, docs (see git diff).

### Acceptance Criteria Status
- R1 ✅ packages/core/src/status/publish.ts:1
- R2 ✅ packages/db/src/schema/status.ts, packages/db/src/__tests__/status-schema.test.ts
- R3 ✅ packages/core/src/jobs/definitions/status-publish.ts, packages/config/src/env/schema.ts
- R4 ✅ cross-tenant-registry.ts, core-domains.js/doc, worker tests, i18n catalog
- R5 ✅ packages/core/src/status/status.test.ts

### Verification
V1 to V7 pass (forgedock checks ran them; V1 re-run for src/status after fixes: 10 passed). The idempotence test fails without the fix (second run reported 'changed'). Core, storage and db tsc are clean. Eslint is clean on the status files.

### Notes
New env STATUS_SIGNING_KEY (dev default). Job name is system.status.publish.

### Stale-list follow-up
The flagged symbols are not members of any list in the named tests (mocks or the runJob probe). The core ones are already in NOT_A_SERVICE. Recorded in result.json not_members; no code change.

## Lint fix
- status-publish.ts: replaced `async () => void (await ...)` with a block body (no-meaningless-void-operator).

## Lint fix
CI lint failed (no log). Committed per-package `.eslintcache` files were the only lint-visible artifact; removed them from git and ignored them. ESLint on all changed ts/js files in core, db, config, storage, i18n and worker tests reports no problems.

## Lint fix 2
No ESLint findings on changed files; prettier --check flagged three files (cross-tenant-registry.ts, storage keys.ts and keys.test.ts). Formatted them, no logic change; keys tests pass.
