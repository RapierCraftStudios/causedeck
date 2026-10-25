### Approach
Settings card on the existing notifications page with one server action per operation, calling `@causedeck/core/whatsapp-link` on the workspace transaction for the signed-in member only. A wrong code is returned as a value so core's attempt count commits.

### Changes
- apps/web/app/(app)/w/[slug]/settings/notifications/whatsapp-actions.ts: request/verify/setCategories/unlink/get actions (masked number only, domain errors mapped, RATE_LIMITED -> CONFLICT).
- apps/web/components/notifications/whatsapp-link-card.tsx: client card (opt-in, code, categories from WHATSAPP_CATEGORIES, unlink).
- .../settings/notifications/page.tsx: loads the link via inWorkspace + getWhatsAppLink, renders the card below the push card; a load error shows a message only.
- packages/i18n: whatsapp-link namespace (en/ta/kn), catalog.ts, catalog test, regenerated generated files and translation-status.json.
- Tests: whatsapp-link-actions, whatsapp-link-card, cross-tenant-actions entries.

### Acceptance Criteria Status
- R1 ✅ whatsapp-link-card.tsx, page.tsx (WhatsAppSection)
- R2 ✅ whatsapp-actions.ts
- R3 ✅ packages/i18n/src/messages/*/whatsapp-link.json, catalog.ts, catalog.test.ts
- R4 ✅ cross-tenant-actions.test.ts (ACTIONS, inputs, snapshotA, B-workspace test)
- R5 deferred (OTP template needs provider approval; amendment)

### Verification
- V1 web vitest (4 files): pass, 42 tests. New tests fail without the fix (modules absent).
- V2 i18n vitest: pass, 37 tests.
- V3 cross-tenant-actions (tenancy config): pass, 26 tests.
- V4 checks.mjs: ran; `tsc --noEmit` in apps/web clean, prettier and eslint (changed files) clean.

### Notes
No env vars. The code is not delivered over WhatsApp yet (no sendOtp, R5 deferred).

### Stale-list follow-up
The 30 flagged sibling lists (nav, routes, shortcuts, API dirs, e2e) are not i18n namespace lists; recorded as not_members in result.json. No code change.

### Post-merge verification
The merge failure (`turbo: command not found`, exit 127) was environmental: `turbo` was not on PATH. No code conflict. Reran via `pnpm exec turbo run typecheck --filter='...[722c3900]'` (23 tasks passed), plus V1 (42 tests) and V2 (37 tests): all pass. No source change.

### Post-merge typecheck
Bare `turbo` is not on PATH (exit 127, environment). `pnpm turbo run typecheck --filter=...[722c3900]` on the merged tree: 23/23 tasks successful, no code change needed.
