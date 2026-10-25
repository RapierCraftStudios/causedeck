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
