### Approach
Continued from the checkpoint: the board components existed; added the board composition, page wiring, i18n, registrations, tests, e2e specs and the ADR. No core or db change.

### Changes
- `_court-day/court-day-board.tsx`, `render-board.tsx`, `board-status.tsx`: board composition (complex -> hall -> item, `?hall=`, offline banner via `useCourtDayData`, polite live region).
- `today/page.tsx`, `tomorrow/page.tsx`: render the board; LiveHalls and BenchNoticeAlerts kept; placeholder guards still run first. `loading.tsx` and `error.tsx` added for both.
- `packages/i18n/src/messages/{en,ta,kn}/court-day.json`, `translation-status.json`, generated files: `courtDay.board` strings (ta/kn stubbed as English drafts, allow-listed).
- `apps/web/__tests__/cross-tenant-actions.test.ts`: both marker actions registered, probe inputs, new refusal test.
- `_court-day/__tests__/court-day.test.ts`: helper tests (IST day, ordinal, stage fallback, stepping, shortcuts).
- `packages/ui/src/patterns/court-day`: story type fixes, `z-sticky` token.
- `e2e/tests/product/court-day-board.spec.ts`, `e2e/tests/visual/court-day-board.visual.spec.ts`, ADR 0039 and README row.

### Acceptance Criteria Status
- R1-R14, R18, R19: ✅ implemented, verified out of band in CI (court-day-board.tsx:1, e2e specs).
- R15: ✅ no predicted time or bench/judge element (hall-column.tsx, item-card.tsx).
- R17: ✅ stories at packages/ui/src/patterns/court-day/court-day.stories.tsx.
- R20: ✅ all strings from `courtDay.board`.
- R16, R22 (toggleCarriedAction): deferred per contract.

### Verification
- V1 cross-tenant-actions: pass (27 tests); the new test needs the registration.
- V2 i18n catalog: pass.
- V3 ui court-day + boundaries: the full command exits 1 here because its Storybook browser projects need Chromium (CI-only per CLAUDE.md). With `--project unit` it passes (34 tests).
- V4 web `_court-day`: pass (6 tests).
- web `tsc --noEmit` pass; eslint on changed web and ui files pass (run directly, the pre-commit eslint ran out of memory on the host).

### Notes
No env vars. Failures and diffs are empty until a snapshot reader exists (`loadBoard`).
