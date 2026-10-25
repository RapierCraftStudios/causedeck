### Approach
Pure engine in `packages/drafting`: block-tree helpers, slot resolvers over a supplied `Facts` object, preset data, DOCX and PDF renderers, and a narrative function that talks to an injected port. The `draft_narrative` task, `karnataka_hc` and `hearing.bench` were added additively.

### Changes
- packages/drafting/src/blocks.ts, slots.ts: walk/validate/collect; `resolveSlot` returns `{value, provenance}`, unresolved gives `[[missing: <resolver>]]`, `exportBlockers`.
- packages/drafting/src/presets/*: Madras (20 MB cap) and Karnataka presets, `getPreset`.
- packages/drafting/src/render/docx.ts, pdf.ts, common.ts: DOCX with `AI-assisted` custom property; PDF with embedded Noto fonts and `PdfTooLargeError`.
- packages/drafting/src/narrative.ts: `draftNarrative` (port, schema-validated, maxChars, indiaOnly default true).
- packages/drafting/src/index.ts, vitest.config.ts (coverage lines 90), tsconfig.json (allowImportingTsExtensions, needed to typecheck the ai sources).
- packages/drafting/src/__tests__/engine.test.ts (+ snapshot): tests.
- packages/ai: `draft_narrative` task, TASK_IDS, registry, BEDROCK_TASKS, task test.
- packages/validators: `karnataka_hc`, `hearing.bench`; test.
- package.json, pnpm-lock.yaml: dependencies.

### Acceptance Criteria Status
- R1 ✅ packages/drafting/src/slots.ts:50, blocks.ts
- R2 ✅ packages/drafting/src/presets/madras-hc.ts:10
- R3 ✅ packages/drafting/src/render/docx.ts
- R4 ✅ packages/drafting/src/render/pdf.ts
- R5 ✅ packages/drafting/src/narrative.ts, packages/ai/src/tasks/draft-narrative.ts
- R6 ✅ engine.test.ts "static API"
- R7 ✅ packages/drafting/package.json
- R8 ✅ coverage 100% on slots/presets; styles.xml snapshot; no `any` test

### Verification
- V1 drafting vitest: pass (15 tests; new tests fail without the fix, the modules do not exist).
- V2 ai tasks/policy/providers: pass.
- V3 validators drafting.test.ts: pass.
- V4 checks.mjs: pass. Also ran tsc --noEmit and eslint on packages/drafting: clean.

### Notes
- PDFs use Noto Sans Latin/Tamil/Kannada (Times New Roman cannot be embedded); DOCX names Times New Roman.
- `indiaOnly` is passed in the run context; the gateway's own residency policy remains authoritative.

## Stale-list follow-up
No edits to pricing.test.ts / providers.test.ts: neither enumerates the task registry (recorded in result.json not_members).
