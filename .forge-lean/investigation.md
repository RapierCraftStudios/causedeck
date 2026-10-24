**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature, part 2 of #508; data model #682 already merged)
**Task Type**: feature

### What Was Claimed
Add a core `provisioning` domain (parse CSV, validate roles, dry-run, invite or add members, audit), a bulk CSV dialog on `settings/members`, and SCIM v2 Users endpoints under `apps/web/app/api/scim` authenticated by `scim_token`. Register core exports, actions, i18n namespace and the core-domains doc. Acceptance: provision 100 users from CSV (integration).
(Note: the FORGE:INVESTIGATION comment on the issue describes a portfolio UI and belongs to another issue; it was ignored.)

### What We Found
- Tables exist, no behaviour: `packages/db/src/schema/enterprise.ts:69-91` (`scim_token`: `tokenHash` unique, `prefix`, `expiresAt`, `revokedAt`, `lastUsedAt`), `:93-122` (`provisioning_run`: source csv|scim, status, dryRun, counts, `report` jsonb). Registry entries for them are `DB_TABLES_TEST` (`packages/db/src/testing/cross-tenant-registry.ts:151`), two-tenant seeder `packages/db/src/testing/two-tenants.ts:1086`.
- No `provisioning` core domain: `ls packages/core/src` has none; `CORE_DOMAIN_DEPENDENCIES` is `packages/config/eslint/core-domains.js` (e.g. `'api-keys'` at :52); `docs/engineering/core-domains.md` has a table row (:31 for api-keys), mermaid edges (:160), and a dependency table (:214). "Adding a domain" steps at :246-254.
- No SCIM route: `apps/web/app/api/` has only activity, audit, auth, captures, exports, ics, push, uploads.
- SCIM bearer auth needs a pre-workspace lookup: `scim_token` is FORCE-RLS, so a token hash cannot be read before the workspace is known. Precedent: `app_api_key_by_hash` (owner-defined SECURITY DEFINER, `packages/db/migrations/0081_api_keys.sql:34-46`) and `authenticateApiKey` (`packages/core/src/api-keys/index.ts:239-256`, registry `caller-checked` at `cross-tenant-registry.ts:655`). The #682 migration (`20261024192746_enterprise_onboarding.sql`) did not add an equivalent, so a new migration is required.
- Existing members service: `inviteMember` (`packages/core/src/workspaces/invitations.ts:147`) enforces `INVITE_RATE_LIMIT` 20/hour per actor (`:33`, applied in the call at ~:158), so 100 CSV rows cannot go through it as is. It also needs a `Mailer`+`appUrl` (`:136-142`). Seat gate: `entitlements.assertCanAddSeat` (`members.ts:303-322`). Permission: `requireCan(tx, ws, user, 'member.invite')` (`members.ts:32`; actions in `packages/auth/src/policy/actions.ts:6`).
- No workspaces function adds a user + active `member` row without an invitation acceptance (needed by SCIM POST and "add members"); `user` has `email` unique (`packages/db/src/schema/auth.ts:54-67`).
- Audit actions are a closed registry: `packages/core/src/audit/events.ts:17-` (`api_key.created` at :109); new events must be added.
- Members page: `apps/web/app/(app)/w/[slug]/settings/members/{page.tsx,actions.ts,invite-dialog.tsx}`; actions go through `workspaceAction` (`apps/web/lib/workspace-action.ts`) and are listed in `apps/web/__tests__/cross-tenant-actions.test.ts` `ACTIONS`.
- CSV precedent: `packages/core/src/portfolio/csv.ts` (RFC 4180 reader, row cap) can be copied; cross-domain imports must go through `index.ts` only.
- i18n: namespaces in `packages/i18n/src/catalog.ts`, JSON per locale (`packages/i18n/src/messages/{en,kn,ta}/`), expected list in `packages/i18n/src/__tests__/catalog.test.ts`.
- Route precedent for token-credential route handlers: `apps/web/app/api/ics/[token]/route.ts` (uses `db` from `@causedeck/core/runtime`).

### Root Cause
Feature gap: #682 landed schema only. No provisioning service, no SCIM surface, no bulk UI, and the workspaces domain lacks a bulk-safe, non-email way to add a member.

### Affected Files
- New domain `packages/core/src/provisioning/{index.ts,csv.ts,provision.ts,scim-token.ts,scim.ts}` + tests.
- `packages/core/src/workspaces/{invitations.ts,members.ts or new provisioned-member.ts,index.ts}`: bulk-safe invite (skip per-actor rate limit) and `addProvisionedMember`/deactivate helper.
- `packages/core/src/audit/events.ts` (new actions), `packages/core/package.json` (`./provisioning` export), `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`.
- New migration `packages/db/migrations/<next>_scim_token_lookup.sql` (+ `meta/_journal.json`, snapshot) defining `app_scim_token_by_hash`; `packages/db/src/schema/enterprise.ts` header comment.
- `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`.
- `apps/web/app/(app)/w/[slug]/settings/members/{actions.ts,bulk-csv-dialog.tsx,page.tsx,members-table or header wiring}`; `apps/web/__tests__/cross-tenant-actions.test.ts`.
- `apps/web/app/api/scim/v2/{Users/route.ts,Users/[id]/route.ts,ServiceProviderConfig/route.ts}`.
- `packages/i18n/src/{catalog.ts,messages/{en,kn,ta}/provisioning.json,__tests__/catalog.test.ts}` (+ generated types if checked in).

### Sibling Sweep
Same pattern as `api-keys` (hashed token, definer lookup, registry `caller-checked`); every new `@causedeck/core` runtime export needs a `SERVICE_TESTS`/`NOT_A_SERVICE` entry. #683 (SSO) and #685 (migration concierge) are siblings that will add their own domains/namespaces; keep provisioning self-contained to avoid shared-hub conflicts.

### History
Parent #508 (closed not_planned umbrella). #682 (schema, merged, be0f4b12) and #686 (seat plans, f2ee4075). No prior provisioning code.

### Recommendation
1. workspaces: add an option to `inviteMember` to bypass the per-actor hourly cap for bulk callers (provisioning enforces its own row cap, e.g. 500) and add `addProvisionedMember` (find-or-create user, insert active member, seat gate, role never `owner`) plus a `deactivateProvisionedMember` (SCIM DELETE/active=false, reuse `removeMember` rules).
2. provisioning domain: `parseProvisioningCsv` (header email,name?,role; BOM/CRLF/quoted; dedupe; role validation against invite roles), `provisionFromCsv({dryRun})` (plan: create/skip-existing/error per row; dry-run writes only a `provisioning_run` row with report and changes nothing else; real run adds existing users directly and invites new emails; one audit event per run), `createScimToken`/`listScimTokens`/`revokeScimToken` (owner only, token shown once, sha256 stored), `authenticateScimToken` (via `app_scim_token_by_hash`, updates `lastUsedAt`), SCIM user mapping (`listScimUsers`, `createScimUser`, `getScimUser`, `patchScimUser`, `deleteScimUser`) returning SCIM v2 schema JSON with a SCIM error envelope.
3. Migration for `app_scim_token_by_hash` mirroring 0081; new migration number is the next free timestamp on the milestone branch.
4. Web: server action `provisionMembersCsvAction` (dryRun flag; `workspaceAction`, owner/inviter policy), `bulk-csv-dialog.tsx` (upload/paste, dry-run report, confirm), wired from the members page header; SCIM route handlers that return `application/scim+json`, 401 on a bad token.
5. Register everything (core-domains map + doc, i18n `provisioning` namespace in en/kn/ta, catalog test, cross-tenant registry + services test, ACTIONS probes). Integration test: provisioning 100 CSV rows creates 100 members/invitations, dry-run writes none.

### Related Issues
#508 (parent), #682 (schema, done), #683 (SSO), #685 (migration concierge), #686 (seat plans).
