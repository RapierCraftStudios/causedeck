### Approach
Recovery pass for ci.red. The failing check was `apps/api` openapi.test.ts (committed openapi/v1.json stale after adding `/v1/inbound/whatsapp`). Also removed the re-tracked `.eslintcache` files (scope creep).

### Changes
- apps/api/openapi/v1.json: regenerated via `openapi:export`, prettier-formatted (+126 lines, whatsapp route and ack schema only).
- apps/*/.eslintcache, packages/*/.eslintcache: untracked (not deliverables).
- Earlier work (capture whatsapp-inbound module, db schema and migration, core receive/run/job, api route) unchanged.

### Acceptance Criteria Status
- R1: ✅ apps/api/src/routes/inbound-whatsapp.ts, packages/capture/src/whatsapp-inbound/meta.ts
- R2: ✅ packages/core/src/whatsapp-link/receive.ts, run.ts
- R3: ✅ packages/core/src/jobs/definitions/whatsapp-intake.ts
- R4: ✅ apps/api/src/routes/inbound-whatsapp.ts (silent drop), core receive.ts

### Verification
- V1-V5 (capture, core, api, db, worker vitest): PASS via forgedock check.
- openapi.test.ts: fails without the regenerated v1.json (CI failure), passes with it.

### Notes
No behavior or env changes in this pass.

## Stale-list follow-up
Checked the flagged tests: none enumerate whatsapp siblings (whatsappLink/whatsappOtpChallenge absent), so all symbols are recorded as not_members in result.json. The core cross-tenant factory is already in NOT_A_SERVICE.

## Merge check fix
The merge failure was `turbo: command not found` (exit 127), a PATH problem. The merged tree has no symbol clash. Ran `pnpm exec turbo run typecheck --filter=...[c44d5405]` (24/24 pass) and capture vitest V1 (12 pass). No source changes.

### Merge verification
After merging the base, `pnpm turbo run typecheck --filter='...[c44d5405]'` passes on the merged tree (24/24 tasks). The earlier exit 127 came from invoking bare `turbo`, which is not on PATH; there are no duplicate-key or symbol clashes, so no code change was needed.
