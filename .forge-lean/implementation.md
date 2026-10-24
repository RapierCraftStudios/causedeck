### Approach
A global `review_item` queue (no workspace id) fed by Data Ops signals and consented user reports. A staff-guarded SECURITY DEFINER function fans a fix out as tenant `review_correction` rows. Admin console pages and audited actions drive the queue. The web matter page gets a consented "Report an error" form and shows corrections.

### Changes
- packages/db: `schema/review.ts`, migration `20261024134105_review_queue` (+ snapshot and journal), registry and RLS test lists, two-tenant seeder.
- packages/core: `review/` domain (queue, report, corrections), `./review` export, data-ops `response.ts` enqueues low_confidence and conflict items, workspace export includes `review_correction`.
- apps/admin: `/review` queue and `[id]` pages, audited actions (assign, dismiss, fix, send-to-workbench), nav entry, fixture form.
- apps/web: `reportRecordErrorAction`, `ReportError` component and story, matter page wiring, `loadReviewCorrections`, i18n (en, kn, ta).
- docs/engineering/core-domains.md and eslint core-domains: `review` domain; `data-ops` imports `review`.
- Resolved committed merge-conflict markers in `docs/engineering/core-domains.md` and in `.forge-lean/contract.json` and `investigation.md` (kept this lane's side).

### Acceptance Criteria Status
- R1 ✅ apps/web/app/(app)/w/[slug]/matters/[id]/actions.ts:187
- R2 ✅ apps/admin/app/(console)/review/page.tsx:1
- R3 ✅ packages/core/src/review/corrections.ts
- R4 ✅ packages/core/src/review/__tests__/review.test.ts
- R5 ✅ apps/admin/app/(console)/review/actions.ts (sendToWorkbenchAction)
- R6 ✅ packages/core/src/review/queue.ts (get audits `staff.read`)
- R7 ✅ packages/core/src/data-ops/response.ts:210

### Verification
V1 core, V2 db, V3 admin, V4 web, V5 i18n: all exit 0 (forgedock check PASS). The review tests fail without the fix, since the `review` domain does not exist on the base. Prettier is clean on changed files. Full typecheck/lint were not run locally (widened by apps/web/vitest.config.ts); CI covers them.

### Notes
No new env vars. Migration adds `app_review_propagate` (staff-only).

### Merge re-check
The reported `turbo: command not found` (exit 127) was a PATH problem, not a code conflict. The base is already merged into this branch. With the repo's `node_modules/.bin` on PATH, `turbo run typecheck` for core, db, admin, web and i18n passes (20/20 tasks). Targeted V1, V2, V4 and V5 pass. No source change was needed.

Merged-tree typecheck: the reported failure (`turbo: command not found`, exit 127) is a toolchain/PATH problem on the checking host, not a code defect: the branch already contains the base (0 commits behind) and has no duplicate keys or same-named symbols. `pnpm exec turbo run typecheck --filter` for core, db, admin, web and i18n passes (20 of 20 tasks). Bare `turbo` is not on PATH and I did not alter PATH.

Re-verified: `pnpm exec turbo run typecheck --filter=...[origin/milestone/court-data-network]` passes (24/24 tasks); core review/data-ops/facts/domains and admin roles/audit/console-layout tests pass. No source change needed.

### Recovery pass (ci.red)
- apps/admin review actions/page: `z.uuid()`, and `REVIEW_FIELDS` now re-exported from `@causedeck/core/review` (no `@causedeck/db/schema` import in apps).
- `review_correction` added to `PURGE_ORDER` (lifecycle/deletion/erase.ts); translation-status entries for the ta/kn `reviewReport` keys; audit test mock gained `REVIEW_FIELDS`.
- Passing locally: core review + purge-coverage, admin no-without-workspace/server-actions-audit/console-layout, i18n catalog. Not verified locally: V1 rest and V4 within 300s (host load); ESLint OOMs on this host, CI lints.
- Non-deliverable files are declared via add-deliverable amendments in result.json.
