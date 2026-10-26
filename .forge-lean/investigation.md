**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: low (additive UI/i18n groundwork for the drafting studio, #79 part 1)
**Task Type**: feature

### What Was Claimed
Add a `CitationStatus` UI pattern (verified / not found / unknown; glyph plus text label, Provenance Chip conventions, story, test) exported from `patterns/index.ts`, and a `drafting` i18n namespace (en, ta, kn) with every studio key, registered in `catalog.ts` and `catalog.test.ts`.

### What We Found
- `packages/ui/src/patterns/index.ts:1-40` exports patterns per folder; no citation-status exists. Template to copy: `patterns/stage-badge/stage-badge.tsx` (icon + label capsule, `label` override prop for translations) and `provenance-chip/provenance-chip.tsx:55-70` (capsule classes, `forced-colors:border-current`, wrapping labels).
- `packages/ui/src/patterns/boundaries.test.ts:5-13` restricts UI imports to react, radix-ui, vaul, lucide-react, cva, clsx, motion; the pattern must stay within these.
- `packages/i18n/src/catalog.ts:6-42` `NAMESPACES` has no `drafting` (only `drafting-templates`, top-level key `draftingTemplates`). Top-level keys `offline` and `shortcuts` already exist (errors.json, shell/pwa), so the new file must use a single top-level key `drafting` containing nested `offline`, `shortcuts` etc. (mergeNamespaces throws on duplicates, catalog.ts:55-70).
- `packages/i18n/src/__tests__/catalog.test.ts:64-70` requires one file per namespace per locale; `:78-120` asserts the exact sorted top-level key list (needs `'drafting'`); `:71-75` ta/kn key sets must equal en; `:77-82` committed `src/generated/messages/{en,ta,kn}.json` and `messages.d.ts` must match (`pnpm i18n:types`).
- `packages/i18n/translation-status.json` lists every ta/kn key as `"draft"` (e.g. line 3283 for draftingTemplates); `scripts/check-catalogs.ts:1-30` fails on missing status, empty strings, ICU/arg mismatch, ta/kn equal to en (unless in `allowUntranslated`). "Stubs" therefore need real non-English text, marked draft.
- Core `CitationStatus` exists in `packages/core/src/drafting/citations.ts`; UI must not import core, so define a local status union (`'verified'|'not_found'|'unknown'`) in the pattern.

### Root Cause
Not a defect: the feature has not been built. #826-#828 (siblings) need these pieces.

### Affected Files
packages/ui/src/patterns/citation-status/{citation-status.tsx,citation-status.stories.tsx,citation-status.test.tsx}; packages/ui/src/patterns/index.ts; packages/i18n/src/messages/{en,ta,kn}/drafting.json; packages/i18n/src/catalog.ts; packages/i18n/src/__tests__/catalog.test.ts; packages/i18n/translation-status.json; packages/i18n/src/generated/messages/{en,ta,kn}.json and messages.d.ts (regenerated).

### Sibling Sweep
Each prior namespace (drafting-templates, research) followed the same checklist: file x3 locales, NAMESPACES, catalog.test top-level list, translation-status draft entries, regenerated outputs. CLAUDE.md requires `packages/i18n/src/__tests__/catalog.test.ts` update for a new namespace. No `'use server'` action, core export or table is added, so no cross-tenant registry changes.

### History
`drafting-templates` namespace added with #76 (3917bf5f touched its ta file). No prior citation-status pattern.

### Recommendation
Implement against base `milestone/drafting-citations-research`: build the pattern (icons CheckCircle2 / CircleOff-or-SearchX / HelpCircle from lucide-react, per-status soft colour classes, `data-slot="citation-status"`, `data-status`, `label` prop defaulting to English, icon `aria-hidden`), then the three JSON files under a single `drafting` key, register, run `pnpm --filter @causedeck/i18n i18n:types`, then add ta/kn "draft" entries to translation-status.json (check `i18n:check --report` output).

### Related Issues
Parent #79 (closed not_planned); siblings #824, #826, #827, #828, #829 consume these keys and the pattern.
