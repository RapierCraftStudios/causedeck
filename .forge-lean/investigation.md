**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature; engine for #768, no live defect)
**Task Type**: feature

### What Was Claimed
Part 2 of #75: build the pure drafting engine in `packages/drafting` (blocks, slot resolvers, Madras/Karnataka presets, DOCX and PDF render, injected-port narrative) plus a `draft_narrative` gateway task in `packages/ai`.

### What We Found
- `packages/drafting/src/index.ts` is a stub (`packageName` only); `package.json` has no runtime deps (no docx, pdf-lib, fontkit, fflate, validators, ai). No `blocks.ts`, `slots.ts`, `presets/`, `render/`, `narrative.ts` exist (`git ls-tree origin/milestone/drafting-citations-research packages/drafting`).
- #766 landed: `packages/validators/src/drafting.ts` has `BlockSchema`/`Block`, `SLOT_RESOLVERS` (:24), `COURT_PRESETS` (:38), `FormatPresetSchema`, `ExportFormat`. Subpath export `@causedeck/validators/drafting` (`packages/validators/package.json:10`).
- Gaps vs this issue: `SLOT_RESOLVERS` has no bench and no counsel names beyond `advocate.name`/`advocate.enrolment_no`; `COURT_PRESETS` has `madras_hc` but NO `karnataka_hc`, and `FormatPresetSchema.key` is `z.enum(COURT_PRESETS)` (so a karnataka preset fails validation). `packages/db/src/schema/drafting.ts:43` only comments that the db column holds the validators key (jsonb/text, no db enum to change - verify when editing).
- Gateway: `AiGateway.run(taskId, input, ctx)` (`packages/ai/src/gateway.ts:38`); tasks are `TaskDef` (`packages/ai/src/types.ts:21`, `tier:'drafting'` exists at :36). A new task needs: id in `TASK_IDS` (`types.ts:5-20`), a `tasks/<name>.ts`, entry in `TASKS` (`tasks/registry.ts:19`), id in `BEDROCK_TASKS` (`providers/bedrock.ts:15`). Guard test requires `promptId` to contain the id (`__tests__/policy.test.ts:55`) and the mock synthesises a valid output for every task (:62). Template: `tasks/summarise.ts`.
- Deps available in the catalog: `docx 9.5.1`, `fflate 0.8.3`, `@pdf-lib/fontkit 1.1.1`, `@fontsource/noto-sans-tamil|kannada 5.3.0`, `pdf-lib` (`pnpm-workspace.yaml:60,78,120,131`); all installed in `node_modules/.pnpm`. `pdf-lib` is in the catalog (used by `packages/core/package.json:83`).
- Precedent for Tamil/Kannada embedding: `packages/intelligence/src/synthetic/make-docs.ts:10-18` (imports `regenerator-runtime/runtime.js` before fontkit; resolves `@fontsource/noto-sans-<x>/files/noto-sans-<x>-<x>-400-normal.woff` via `createRequire`). `regenerator-runtime` is a catalog dep there.
- `"AI-assisted"` doc property is required by `docs/engineering/08-repo-structure-and-backlog.md:200`, `docs/product/03-prd.md:267` (DR-4).
- `@causedeck/drafting` is already a dependency of `apps/web/package.json:56`; core depends on drafting per `docs/engineering/13-technical-architecture-spike.md:94`.

### Root Cause
Missing feature: only a stub package exists, so #768 (service/export job) has nothing to call.

### Affected Files
`packages/drafting/package.json`, `src/{blocks,slots,narrative,index}.ts`, `src/presets/{madras-hc,karnataka-hc,index}.ts`, `src/render/{docx,pdf}.ts`, tests, `packages/validators/src/drafting.ts` (+test), `packages/ai/src/{types.ts,tasks/registry.ts,tasks/draft-narrative.ts,providers/bedrock.ts}` + test, `pnpm-lock.yaml`.

### Sibling Sweep
Other task registrations follow the same 4-place pattern (types, registry, bedrock list, task file). `TASK_IDS` consumers elsewhere (`packages/intelligence`) only reference ids; no other list needs the new id (grep for `tag_notice` found only those places).

### History
#766 added the data layer and validators (merge 4f1da658). No prior engine work. Parent #75 closed not_planned and split.

### Recommendation
Implement per `contract.json`. Keep the engine pure: facts in, `{value, provenance}` out; narrative via an injected port typed locally (no import of `ai` runtime needed beyond the task schemas/types). Latin text: pdf-lib `StandardFonts.TimesRoman`-like is not "embedded", so embed a fontkit font for all scripts (Noto Sans Tamil/Kannada from fontsource; Latin via standard font is acceptable only if text remains searchable - prefer embedding a Latin-capable face; Noto Sans Tamil/Kannada woff include basic Latin glyphs? verify, else add `@fontsource/noto-sans` to the catalog as a decision). Extend validators with `karnataka_hc` preset and a `hearing.bench` resolver (keep the closed-list tests green).

### Related Issues
#75 (parent), #766 (data layer, done), #768 (service/export job, consumes this), #76 (system templates).
