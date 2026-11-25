forge-stamp: issue=1192 contract=e06f434f2dbc

### Approach
Reuse the D-004 marker filter for a new optional bottom line (K1), carry it as a required `MatterAnswer.bottomLine` string (K2), and render the answer with a small in-repo markdown renderer that only builds React elements (K3). Citation chips become anchors that scroll to and persistently highlight their source. The no-authority and weak (K4) states show a reason and three next steps.

### Changes
- `packages/ai/src/tasks/answer-matter-question.ts`: optional `bottomLine` (max 300) with a Yes/No-first, `[n]`-citing describe(); promptId `answer_matter_question.v3`; header comment.
- `packages/intelligence/src/research/answer-sources.ts`: `MatterAnswer.bottomLine`; replySchema accepts it; run through `rewriteMarkers` with `verifiedAt`, kept only when a verified marker survives, else `''`; `''` on the no-sources path. `answerText` unchanged.
- `packages/core/src/copilot/ask.ts`: `bottomLine: ''` on the aiBlocked literal.
- `apps/web/components/copilot/answer-markdown.tsx` (new): paragraphs, `**bold**`, `*italic*`, `` `code` ``, `-`/`*`/`•`/`1.` lists, `#` headings as a bold line; `[n]`/`[n, m]` markers become chips for verified claims only; stray `**` is dropped; no HTML, no links.
- `apps/web/components/copilot/copilot-answer.tsx`: bottom line first (semibold, sr-only "Bottom line" label), then the markdown answer; `CiteChip` is `<a href="#<prefix>-source-n">` and its click calls `onShowSource`; `SourceItem` gets `id`; `SourcesList`/`SourcesSheet` take `idPrefix`; `parseAnswer` now handles `[n, m]` (delegates to `splitCitations`).
- `apps/web/components/copilot/copilot-panel.tsx`: `workspaceSlug` prop; `pinned` highlight state; `showSource` scrolls to the rail source (desktop) or opens the Sheet and scrolls to its source; `NextSteps` for the no-authority and weak states: "Search Research for “q”" (`/w/<slug>/research?q=`), "Rephrase" (refills and focuses the composer), "Ask with a matter" (workspace copilot only, `/w/<slug>/matters`). `matterId` accepts explicit undefined.
- Both copilot pages: pass `workspaceSlug={slug}`.
- Stories: `bottomLine` on literals; `MarkdownAnswer`, `NoAuthority` (with next steps) and `Weak` stories.
- i18n en/kn/ta `research.copilot`: `bottomLine`, `noAuthorityReason`, `weak.{title,reason}`, `nextSteps.{label,searchResearch,rephrase,askWithMatter}` (kn/ta translated); regenerated catalogs and `messages.d.ts`; `translation-status.json` entries (draft).
- `docs/engineering/copilot-quality.md`: the v3 bottom line, verified like claims; eval scores claims only.
- Tests: matter-question (v3, schema with/without bottomLine), answer-sources (kept+renumbered, dropped unverified/uncited/absent, no claim verified), core copilot (bottomLine passes through askCopilot), web copilot (markdown, HTML inert, bottom line first, chip links scroll/highlight, both empty states, no next steps on verified/AI off).

### Acceptance Criteria Status
- R1 ✅ packages/ai/src/tasks/answer-matter-question.ts:43, apps/web/components/copilot/copilot-answer.tsx:109
- R2 ✅ packages/intelligence/src/research/answer-sources.ts:275
- R3 ✅ apps/web/components/copilot/copilot-answer.tsx:66
- R4 ✅ apps/web/components/copilot/copilot-panel.tsx:523
- R5 deferred by contract (post-deploy; conditional on reader/source links)
- R6 ✅ apps/web/components/copilot/answer-markdown.tsx:47
- R7 ✅ apps/web/components/copilot/answer-markdown.tsx:86
- R8 ✅ apps/web/components/copilot/copilot-panel.tsx:665
- R9 ✅ apps/web/components/copilot/copilot-panel.tsx:274
- R10 ✅ apps/web/__tests__/copilot.test.tsx:468
- R11 ✅ packages/ai/src/tasks/answer-matter-question.ts:58
- R12 ✅ packages/i18n/src/messages/en/research.json:163

### Verification
- V1 matter-question.test.ts: pass (7). V2 answer-sources + eval runner: pass (36). V3 core copilot.test.ts: pass (22). V4 web copilot.test.tsx: pass (33). V5 i18n catalog: pass (34). G1 gateway + chatgpt-plan: pass (39). `forgedock check`: PASS.
- `pnpm i18n:check`: in sync. Typecheck: `lane-check.sh typecheck` deferred itself to CI on the busy host; ran `typecheck` for @causedeck/web, @causedeck/ai, @causedeck/intelligence directly: all exit 0. ESLint on changed files (pre-commit hook): clean.
- The new tests fail without the fix: base has no `bottomLine` (undefined vs expected), chips are buttons (no `link` role), no `copilot-bottom-line`, `copilot-next-steps` or markdown elements, and promptId is `.v2`.

### Visual Check
not rendered: the repo's rules forbid Storybook/visual runs and `next build` locally, and the routes need a seeded DB and auth; the new `MarkdownAnswer`, `NoAuthority` and `Weak` stories cover the states for the CI visual run. Styling reuses existing tokens and components only (Button secondary/ghost sm with min-h-11, border-line/bg-surface-raised cards like the failure state, text-ink/ink-muted).

### Notes
- Behaviour: a chip click now scrolls and keeps the source highlighted (it previously only opened the Sheet below `lg`); `[n, m]` markers now render as chips (they were plain text). No env vars. Eval fixtures, `answerText` and the audit hash are unchanged.

## Story sibling check
MarkdownAnswer and Weak copilot stories are not members of enquiry-stories.test.ts or page-states.spec.ts lists; recorded in result.json not_members.
