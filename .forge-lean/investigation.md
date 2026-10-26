**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield feature; no live defect, but PX-4 export gate is a guardrail)
**Task Type**: feature

### What Was Claimed
#77 (parent #1, depends on #768 and #44, both closed): build the DR-2 citation checker. It extracts Indian neutral and reporter citations from a draft's block tree, resolves each one via an adapter (mock by default, Indian Kanoon when configured), and marks it `verified | not_found | unknown`. It stores only the citation string, status, canonical URL and short title. Export of a draft with a `not_found` citation needs a logged acknowledgement. False-verified rate must be at most 0.5%. The job is `drafting.citations.check`.

### What We Found
- No citation checker exists: no `authority` table (`packages/db/src/schema/` has only `research-note.ts`/`drafting.ts` etc.), no `packages/drafting/src/citations`, no `INDIAN_KANOON_API_TOKEN` or `CITATION_RESOLVER` in `packages/config/src/env/providers.ts`, and no `drafting.citations.check` job (`packages/core/src/jobs/definitions/` has only `drafting-export.ts`).
- The issue's file paths do not match the repo layout. Jobs live in `packages/core/src/jobs/definitions/*.ts`, registered in `packages/core/src/jobs/registry.ts:48,189,250`, not in `apps/worker/src/jobs`. Migrations are `packages/db/migrations/<timestamp>_name.sql` plus `meta/<ts>_snapshot.json` and `meta/_journal.json` (latest `20261025225346_drafting_export.sql`), not `packages/db/drizzle/00xx`. Tests live in `src/__tests__` or beside the file, not `test/`.
- `@causedeck/drafting` (`packages/drafting/package.json`) depends only on `ai` and `validators`, not `db`. A `checkDraft(tx, ...)` that reads or writes the DB cannot live there without a new workspace dependency. The DB orchestration belongs in the core drafting domain (`packages/core/src/drafting/`), the pure parts in `packages/drafting/src/citations/`.
- The block tree: `packages/validators/src/drafting.ts:67-74`; `walkBlocks` and the stable block key (`block.id ?? 'b.1.0'`) are in `packages/drafting/src/blocks.ts:16-26`. Text-bearing blocks are `heading.text`, `paragraph.text` and `section.title`. Slot and narrative text only exists at render time (`packages/core/src/drafting/service.ts:344 renderDraft`).
- `draft_version` is immutable (`packages/db/src/schema/drafting.ts:108-131`, trigger). So "editing a cited span invalidates its status" maps to a new version having no `authority` rows until it is checked. Statuses attach to `draft_version_id`, so a stale status can never be shown for a newer version. `saveVersion` (`service.ts:195`) and `restoreVersion` (`:229`) should enqueue a check.
- Export gate points: `exportDraft` (`packages/core/src/drafting/service.ts:413`) enqueues; `runDraftingExport` (`packages/core/src/drafting/export.ts:110`) renders and writes. Job wrapper `packages/core/src/jobs/definitions/drafting-export.ts` maps `WorkspaceError` to `PermanentError`. Both need to refuse when a `not_found` citation has no acknowledgement.
- Policy actions `draft.read`, `draft.write`, `draft.export` already exist (`packages/auth/src/policy/actions.ts:14`, `matrix.ts:30-32,54-56`). No new action is needed.
- Audit actions are a registry in `packages/core/src/audit/events.ts` (`draft.exported` at :166). `draft.citations.checked` and `draft.citations.acknowledged` need adding.
- Existing neighbour: `packages/core/src/citations/verify.ts` verifies neutral citations against the raw judgments corpus (`canonicalNeutralCitation` from `@causedeck/intelligence`, `packages/intelligence/src/corpus/header.ts:32`). It handles only INSC and MHC/KHC forms and has no reporter or case-name forms. It is a different mechanism (UNVERIFIED, not the three-state model) and is not the Indian Kanoon adapter.
- Tenant table pattern with RLS: `draftExport` (`schema/drafting.ts:133+`) and migration `20261025225346_drafting_export.sql` (hand-written RLS block: enable, force, `ws_isolation` policy, workspace_id index).
- Registries for a new table and exports: `packages/db/src/index.test.ts:146`, `packages/db/src/__tests__/rls/sql.test.ts:211`, `packages/db/src/testing/cross-tenant-registry.ts:84,173` (table map; `SERVICE_TESTS` at :218, `NOT_A_SERVICE` at :903). Job lists: `apps/worker/src/__tests__/registry.test.ts:146` and `schedules.test.ts`.
- No existing per-workspace resolver rate limiter or daily budget helper fits (AI budgets are in `packages/ai`/`usage`, tied to LLM spend). A small in-package limiter plus a DB-counted daily budget is needed.

### Root Cause
Missing feature. The drafting engine (#767) and the core drafting domain (#768) exist, but nothing detects, verifies or labels citations, and the export path has no citation gate.

### Affected Files
- `packages/validators/src/citation.ts` (+ subpath export in `packages/validators/package.json`)
- `packages/drafting/src/citations/*` (patterns, normalize, extract, match, resolvers, rate-limit) and `packages/drafting/src/index.ts`
- `packages/db/src/schema/authority.ts`, `schema/index.ts`, a new migration, snapshot and journal
- `packages/core/src/drafting/{citations,citation-ack,index,service,export}.ts`
- `packages/core/src/jobs/definitions/drafting-citations-check.ts`, `jobs/registry.ts`
- `packages/core/src/audit/events.ts`
- `packages/config/src/env/providers.ts` (plus any generated env doc)
- Registries: `packages/db/src/index.test.ts`, `__tests__/rls/sql.test.ts`, `testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`, `apps/worker/src/__tests__/registry.test.ts`, `schedules.test.ts` if affected, `docs/engineering/core-domains.md` (only if imports change)

### Sibling Sweep
- Same hazard class (guardrail enforced by static grep): `packages/core/src/automation/no-l5.test.ts` is the precedent for a static "no AI call" test.
- `packages/core/src/research/notes-service.ts` and the drafting `policy.ts` are the access-pattern precedents (`can`, matter visibility, `notFound`).
- `packages/drafting/src/narrative.ts` is the only AI call in the drafting package. The `citations/` dir must never import it or `@causedeck/ai`.
- Other places that print citation-like text (`packages/core/src/research/alerts.ts`, `automation/handlers/order-record.ts`) are not drafts and are unaffected.

### History
- Drafting engine #767 (`d78af9e4`) and core domain #768 (merged, `ec1ced21` is HEAD) are the base. No prior citation-checker work in `packages/drafting`. `packages/core/src/citations` (#484) is the separate corpus verifier.
- Stale `.forge-lean/*` files left in the worktree described #768. They have been replaced.

### Recommendation
Implement in three layers.
1. Pure engine in `packages/drafting/src/citations/`. Extraction yields spans with block keys. A match function awards `verified` only on an exact normalised structured match plus title similarity at or above a configured threshold; everything ambiguous is `unknown`. Resolvers are mock (default) and Indian Kanoon, with a timeout, jittered retry and a rate limiter.
2. A new `authority` tenant table (migration, RLS, registries) and core orchestration `checkDraft` plus `acknowledgeUnverified`, with audit events, in `packages/core/src/drafting`.
3. The `drafting.citations.check` job, enqueued on version save and restore, and the export gate.
UI is out of scope (#79). The real Indian Kanoon token and commercial-use confirmation are tracked in #114; the resolver ships mock-by-default.

### Related Issues
#75 (parent, not_planned), #768 (dependency, merged), #44 (gateway and budget conventions), #78 (consistency checker), #79 (UI for statuses and acknowledgement dialog), #80 (research link-outs), #114 (Indian Kanoon token, human).
