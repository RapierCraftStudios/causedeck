**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature; no live defect, no UI for the shipped WhatsApp link service)
**Task Type**: feature

### What Was Claimed
Part 4 of #502: a settings UI to link a WhatsApp number (OTP), choose message categories and unlink, with one server action per operation, an i18n namespace in en/kn/ta with its catalog test, and cross-tenant-actions test entries. Depends on #678 and #679 (both merged).

### What We Found
- Core service exists (#678), verified on base `origin/milestone/instant-gtm-adoption` (c44d5405): `packages/core/src/whatsapp-link/link.ts:90` `requestWhatsAppOtp` (needs `consent`, 60s cooldown), `:166` `verifyWhatsAppOtp`, `:242` `getWhatsAppLink` (masked number), `:254` `setWhatsAppCategories`, `:275` `unlinkWhatsApp`; exported via `@causedeck/core/whatsapp-link` (`packages/core/package.json:37`). `WhatsAppDeps.sendOtp` is optional (`link.ts:32`): without it no code is delivered.
- Outbound sender exists (#679): `packages/notifications/src/channels/whatsapp.ts:18` has templates only for `court.board`, `status.order`, `digest.end_of_day` (`WHATSAPP_CATEGORIES`, `:25`, exported as `@causedeck/notifications/whatsapp`). No OTP template exists.
- No web UI or action references WhatsApp link: `grep whatsapp-link apps/web` finds nothing. Closest pattern: `apps/web/app/(app)/w/[slug]/settings/notifications/{actions.ts,page.tsx,preferences-form.tsx}` (`workspaceAction` + `WorkspaceScoped`, `ctx.tx`, `ctx.userId`; actions are thin async wrappers because a `'use server'` module can only export async functions).
- Errors: core throws domain errors (`NOT_FOUND`, `CONFLICT`, `VALIDATION`, rate-limited); `apps/web/lib/matters/graph-deps.ts:30` `domainErrorCode` + the `guarded` pattern in `settings/case-watch/actions.ts:~64` map them to `ActionError`.
- Page reads under a workspace tx via `inWorkspace` from `@causedeck/core/runtime` (`apps/web/lib/workspace-action.ts:105`).
- Registry guard: `apps/web/__tests__/cross-tenant-actions.test.ts:93-` imports each actions module, `ACTIONS` (`:~118`) maps name to module, probe inputs in `inputs()` (`:~475`), and a per-feature "under B's own workspace" test (`:~937`) checks A's snapshot is unchanged. A new actions file without entries fails that test.
- i18n: `packages/i18n/src/catalog.ts:7` `NAMESPACES` (one file per locale per namespace, asserted by `catalog.test.ts` "exactly one file per namespace"), top-level key list asserted at `catalog.test.ts:~92`; generated catalogs are committed (`packages/i18n/src/generated/`, regenerated with `pnpm --filter @causedeck/i18n i18n:types`, checked by the test "committed generated files match").
- Nav: `apps/web/lib/settings-nav.ts` has fixed section lists; the push card is already placed as a card on the notifications page (`page.tsx` `PushPermissionCard`), so a WhatsApp card there needs no nav change.

### Root Cause
Missing feature: #678 and #679 shipped the service and sender without a user-facing surface, so no member can opt in, verify, choose categories or unlink.

### Affected Files
- new `apps/web/app/(app)/w/[slug]/settings/notifications/whatsapp-actions.ts` (actions)
- new `apps/web/components/notifications/whatsapp-link-card.tsx` (client card)
- `apps/web/app/(app)/w/[slug]/settings/notifications/page.tsx` (load link, render card)
- `packages/i18n/src/messages/{en,kn,ta}/whatsapp-link.json`, `packages/i18n/src/catalog.ts`, `packages/i18n/src/__tests__/catalog.test.ts`, regenerated `packages/i18n/src/generated/**`
- `apps/web/__tests__/cross-tenant-actions.test.ts`; new `apps/web/__tests__/whatsapp-link-actions.test.ts`, `whatsapp-link-card.test.tsx`

### Sibling Sweep
Same defect class (service without UI) not present elsewhere in the lane. Other actions modules are all registered in `cross-tenant-actions.test.ts`; the new module must be too. The nested `settings/integrations/*` modules show per-feature action files are accepted.

### History
Service added in 15574312 (#678); sender in #679 (merged, PR #709). No prior UI attempt. Earlier `.forge-lean/*` files in the tree belong to #679 and are overwritten.

### Recommendation
Add five actions (request OTP, verify, set categories, unlink, get link) via `workspaceAction`; the input never names a user (`ctx.userId`). Add a WhatsApp card to the notifications settings page, a new `whatsappLink` i18n namespace, tests and registry entries. Outbound OTP delivery needs a provider-approved OTP template (an external provider action) and is deferred; until then the request action works without a sender and the code is not delivered.

### Related Issues
#502 (parent), #678, #679 (done), #680 (inbound webhook sibling), #488 (provider residency review).
