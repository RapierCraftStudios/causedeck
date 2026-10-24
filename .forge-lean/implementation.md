### Approach
Continued the checkpointed work: provisioning domain (CSV + SCIM v2), members dialog, migration, registries. This session fixed a web typecheck error (exactOptionalPropertyTypes in ListScimUsersQuery), lint errors (csv.ts, test), and formatted changed files.
### Changes
- packages/core/src/provisioning/*: CSV parser, provisionFromCsv, SCIM tokens and Users service, index
- packages/core/src/workspaces/{provisioned-member,invitations,index}.ts: addProvisionedMember, deactivateProvisionedMember, opt-in bypassRateLimit
- packages/core/src/audit/events.ts, package.json, config core-domains.js, docs core-domains.md: registrations
- packages/db migration 20261025000000 + journal + snapshot, cross-tenant-registry
- apps/web members actions/dialog/page, SCIM routes, cross-tenant-actions test
- packages/i18n provisioning namespace (en/kn/ta), catalog and test
### Acceptance Criteria Status
- R1 ✅ packages/core/src/provisioning/provision.ts
- R2 ✅ apps/web/app/(app)/w/[slug]/settings/members/bulk-csv-dialog.tsx
- R3 ✅ packages/core/src/provisioning/scim.ts, apps/web/app/api/scim/v2
- R4 ✅ core-domains.js, cross-tenant-registry.ts, catalog.ts
- R5 ✅ provisioning.test.ts (100 CSV rows)
### Verification
V1 pass (91 tests), V2 pass standalone (195 tests, ~271s on a host at load ~55; the forgedock check runner's 300s timeout trips), V3 pass, V4 pass, V5 pass (25), V6 pass (18). core and web tsc --noEmit clean. Provisioning test is new, so it cannot pass without the fix.
### Notes
Migration adds app_scim_token_by_hash. No env vars. scripts/check-devdocs-freshness.sh is absent.

### Stale-list fix
Added provisionMembersCsvAction to the members-page actions mock and scim to the static-guards api dir list; other flagged lists are unrelated (see result.json not_members).

### Post-merge typecheck failure
The reported failure (`turbo: command not found`, exit 127) was an environment PATH issue, not a code conflict. No source change was needed. `node_modules/.bin/turbo run typecheck` on core, web, i18n and db plus their dependencies passes (19 tasks).

### Post-merge
Merged the base (journal idx 94, snapshot chained to the base's latest, review header added to the migration). `turbo` is not on the bare PATH; `pnpm exec turbo run typecheck` (core, web, db, i18n) passes, and `tsc --noEmit` is clean for core, web, i18n, db and auth. No duplicate-symbol conflicts were found, so no code change was needed.


## Post-merge typecheck (re-verified)
The reported failure (`turbo: command not found`, exit 127) is a PATH issue in the check runner, not a code conflict. `node_modules/.bin/turbo run typecheck` on the merged tree passes (19/19 tasks). No source change needed.

### Post-merge (2)
Merged the base again (adds core `migration` domain and admin pages). `turbo` is not on the bare PATH; `pnpm exec turbo run typecheck` for core, web, admin, db and i18n passes (20 tasks). No duplicate or same-named symbols, so no code change.

### Post-merge (3)
Re-ran full `turbo run typecheck` with node_modules/.bin on PATH: 24/24 tasks pass. The exit 127 is a runner PATH issue; no source change.
