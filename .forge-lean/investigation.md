**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield backend; #736 web editor and #737 e2e depend on it)
**Task Type**: feature

### What Was Claimed
Part 1 of #69: the outward-update-drafts backend. That means validators (`outward-draft.ts`), tables `outward_draft`, `outward_draft_version` and `outward_share_log` with RLS and a migration, AI task `outward_update` (drafting tier, EN/TA/KN mock fixtures), `packages/core/src/outward/{compose,guard,diff,share,templates/en|ta|kn}.ts`, audit events for prepared/edited/shared, the `outward.shared` event, ADR 0038 (no send path), a core-domains entry and the registries. Tests: compose, guard (30+ phrases per language set), diff, share, no-send, cross-tenant, sensitive template-only, India-only AI, client_contact requirement. The web UI, stories, i18n and e2e belong to #736/#737.

### What We Found
Verified at HEAD 05be6ee8 (merge of #725 / #67).
- Nothing exists: no `packages/core/src/outward/`, no `outward-draft.ts` validator, no `outward_*` tables, no `outward_update` task. Grep for "outward" finds only a doc mention, `proposal-draft.ts` and i18n.
- Model domain to copy: `packages/core/src/obligations/` (`context.ts:1-75` scope, `inObligationScope`, `parseObligationInput`, `can()`, audit `record()` at `context.ts:226`; `index.ts` public barrel). Tables model: `packages/db/src/schema/obligation-tracking.ts` (`tenantTable()`, FORCE RLS, ids via `columns.ts`).
- Registration of the obligations domain to mirror: `packages/core/package.json:35` (`"./obligations"` export), `packages/config/eslint/core-domains.js:137-143` (`CORE_DOMAIN_DEPENDENCIES` and domain list), `docs/engineering/core-domains.md` table, `packages/core/src/domains.test.ts`.
- Cross-tenant and db registries: `packages/db/src/testing/cross-tenant-registry.ts:94-96` (`obligation*: DB_TABLES_TEST`), `SERVICE_TESTS` at `:213`, `NOT_A_SERVICE` at `:876`; `packages/db/src/index.test.ts:128` (root table list); RLS catalog `packages/db/src/__tests__/rls/sql.test.ts:132`; service cases in `packages/core/src/__tests__/cross-tenant/services.test.ts`.
- AI: `TASK_IDS` at `packages/ai/src/types.ts:5-20`; `TaskDef.tier?: 'fast'|'drafting'` at `types.ts:36` (Bedrock picks the drafting model at `providers/bedrock.ts:76`). Tasks are registered in `packages/ai/src/tasks/registry.ts:19-34` and defined like `tasks/summarise.ts` (zod input/output, `promptId`, `providers`). No `prompts/` dir exists, so the issue's `prompts/outward-update.ts` path is outdated and the prompt is the `promptId` plus the task file. Mock fixtures are `packages/ai/fixtures/mock/<task>/<inputHash>.json` (`providers/mock.ts:1-6,28-30`), and without a fixture the mock synthesises output. The gateway already enforces the sensitive block and India-only residency, and audits `ai_call` (`gateway.ts:4,24,167`). `ai_call` status values are in `db/schema/audit.ts:132`.
- Sensitive matters: `matter.sensitive` boolean (`db/schema/matter-graph.ts:32`). A sensitive matter must go template-only with no model call.
- Graph facts with provenance: `hearing` (`docket.ts:105`, `provenanceCheck`), `order`, `obligation` (`docket.ts:234-300`, with confirmation_state), next date (`matter-graph/next-date.ts`). Obligation states and `confirmation_state` give the confirmed vs "to be confirmed" split.
- Policy: `draft.write` exists (`auth/src/policy/actions.ts:15`, junior in `matrix.ts:33`, so no new action or snapshot change is needed). `strategy.read` exists for the clerk-denied case.
- No `client_contact` table and no M2/M6 memory columns (no preferred_language anywhere in the schema). `person` (`schema/people.ts`, kind `client`, `contact` jsonb) is the minimal contact reference, and the language default falls back to the workspace/request language until #72/#82.
- Audit events are declared in `packages/core/src/audit/events.ts` (e.g. `obligation.created` at `:325`). Add `outward.prepared`, `outward.edited` and `outward.shared`.
- ADR 0037 is the latest (`docs/adr/0037-obligation-model.md`), so 0038 is free. The latest migration is `packages/db/migrations/20261025095244_obligation_tracking.sql`.

### Root Cause
Greenfield: the product has no outward-draft model, guard or log, and spike §5 requires the "no send path" and L4 approval posture to be built and tested.

### Affected Files
New: `packages/validators/src/outward-draft.ts` (+ test, `index.ts` export), `packages/db/src/schema/outward-draft.ts` (+ `schema/index.ts`), a migration + meta snapshot, `packages/core/src/outward/*` (+ `__tests__`), `packages/ai/src/tasks/outward-update.ts` (+ `fixtures/mock/outward_update/*.json`), `docs/adr/0038-outward-drafts-no-send-path.md` (+ `docs/adr/README.md` index). Edit: `packages/ai/src/{types,tasks/registry}.ts`, `packages/core/package.json`, `packages/core/src/audit/events.ts`, `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`, `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`, and any AI task-list guard tests.

### Sibling Sweep
- `obligations` domain (#67) is the same shape of work and the template; its misses in CI were registry and scope items (see CLAUDE.md table).
- `obligation-from-direction` (`automation/handlers`) and `extraction` are the other writers of confirmed facts that compose reads; compose only reads them.
- Any job registry/schedule is deliberately NOT added (no auto-share job), so `apps/worker` tests stay untouched; the no-send test asserts it.
- Other AI tasks have no test that enumerates `TASK_IDS` except `pricing.test.ts`/`policy.test.ts` (check when adding the id).

### History
Not previously attempted: #69 was decomposed into #735 (this), #736 (web), #737 (e2e). The earlier comment on #735 is a stale copy of the #67 report and does not apply. The AI gateway (#44) and the obligations service (#67) supply the pieces reused here.

### Recommendation
One lane, ordered: (1) validators; (2) schema + migration + registries; (3) AI task + mock fixtures + registry; (4) audit events; (5) guard, diff, templates, compose (facts from confirmed graph data only, unconfirmed => "to be confirmed" flag; sensitive => template-only; client audience requires a client person); (6) share (`recordShared`/`recordCopied`, lawyer-initiated only, emits `outward.shared`); (7) tests incl. no-send static test and cross-tenant; (8) ADR, core-domains, exports. Defer all web/UI/e2e/stories/i18n criteria to #736/#737.

### Related Issues
#69 (parent), #736, #737 (siblings), #44 (AI gateway), #67 (obligations), #72/#74 (memory, M2/M6), #82 (client contacts), #86 (metrics consumer of `outward.shared`), #112/#113 (credentials), #117, #48.
