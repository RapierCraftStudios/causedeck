**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield feature; no live defect)
**Task Type**: feature

### What Was Claimed
Issue #94 asks for an in-app help center in `apps/web`: at least 15 bundled MDX articles with client-side search, contextual `?` tips, dismissible first-run coachmarks persisted in `help_state` (RLS), a `?` shortcut sheet driven by a central shortcut registry, a Contact support tab (WhatsApp number from `NEXT_PUBLIC_SUPPORT_WHATSAPP`, email fallback), and a user-requested time-boxed audited support session. Depends on #159 (closed, merged).

### What We Found
- The issue thread already carries a FORGE:INVESTIGATION comment, but it is about a different feature (WhatsApp link settings UI, #502 part 4), so it does not apply to #94 and was ignored. The `.forge-lean/*` files in the tree were also stale and were overwritten.
- No help code exists on base `origin/milestone/site-onboarding-launch` (same commit as HEAD, 8c2520a3): there is no `apps/web/content`, no `apps/web/lib/help`, no `help_state` table, no `help` i18n namespace, and no `NEXT_PUBLIC_SUPPORT_WHATSAPP` anywhere.
- A central shortcut registry and a `?` dialog already exist (#157): `apps/web/lib/shortcuts/registry.ts:21` `SHORTCUT_GROUPS`, `:33` `ShortcutDefinition { id, keys, group, labelKey }`, `:57` `SHORTCUTS` (includes `action('help', '?', 'help')` at `:77`), `:150` `createShortcutDispatcher` (ignores plain keys in text fields via `isTypingTarget`, `packages/ui/src/hooks/use-hotkey.ts:118`). `apps/web/lib/shortcuts/provider.tsx` lazy-loads `shortcuts-dialog.tsx` and merges page shortcuts from palette commands (`pageShortcuts`, `:~75`). `apps/web/lib/inbox/shortcuts.ts` holds surface-specific ones. Tests: `apps/web/__tests__/shortcuts.test.tsx`.
- The issue's `packages/ui/src/lib/shortcuts.ts` / `registerShortcut({id, keys, scope, labelKey})` does not exist and would duplicate the registry above.
- Support sessions exist (#313) but are staff-initiated: `packages/core/src/support/sessions.ts:151` `requestSession` needs an active staff user; `packages/db/src/schema/staff.ts:69` `requested_by_staff` is NOT NULL. The owner grants or denies on `apps/web/app/(app)/w/[slug]/settings/support/{actions.ts,page.tsx,support-requests.tsx}` (grant minutes 60/120/240, max 240 at `sessions.ts:45`). No member-initiated request exists, so that acceptance criterion needs a core change.
- No MDX tooling in `apps/web/package.json` (`grep mdx` finds nothing in any workspace package.json; only `@mdx-js/react` is present transitively in `node_modules/.pnpm`). `next build` cannot be run locally.
- Tenant table pattern: `packages/db/src/schema/whatsapp-link.ts` (`tenantTable`, `userRef`, unique per workspace and user); latest migrations are `packages/db/migrations/20261025030000_whatsapp_link.sql` and `20261025040000_whatsapp_inbound.sql`. Core domain docs and dependency map: `docs/engineering/core-domains.md:45,52,223,244`.
- App shell hooks to extend: `apps/web/components/shell/{topbar.tsx,user-menu.tsx,shell-overlays.tsx,use-shell-overlays.ts}`, `apps/web/lib/commands/navigation-commands.ts`, `apps/web/lib/nav.ts`.

### Root Cause
Greenfield: help content, state table, contextual surfaces and member-initiated support request were never built. The shortcut dialog and the support-session core exist but are not wired to a help surface.

### Affected Files
- New: `apps/web/content/help/*.mdx` (15+), `apps/web/lib/help/{index.ts,search.ts,markdown.tsx,lint.ts}`, `apps/web/app/(app)/w/[slug]/help/{page.tsx,[article]/page.tsx,loading.tsx,error.tsx,actions.ts}`, `apps/web/components/help/{help-sheet,help-search,contextual-tip,coachmark,shortcut-sheet,support-contact}.tsx` (+ stories)
- New core and db: `packages/core/src/help/{index.ts,state.ts}`, `packages/db/src/schema/help-state.ts`, migration `packages/db/migrations/<next>_help_state.sql` plus snapshot; a member-initiated support request in `packages/core/src/support` (plus `support_session` migration)
- Edits: `packages/db/src/schema/index.ts`, `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`, `packages/core/package.json` exports, `docs/engineering/core-domains.md`, `CORE_DOMAIN_DEPENDENCIES`, `apps/web/__tests__/cross-tenant-actions.test.ts`, `packages/i18n/src/catalog.ts`, `packages/i18n/src/messages/{en,ta,kn}/help.json`, `packages/i18n/src/__tests__/catalog.test.ts`, generated i18n files, `apps/web/lib/shortcuts/registry.ts`, shell topbar, user menu and palette commands, the five surface pages for tips, `.env.example` / env schema for `NEXT_PUBLIC_SUPPORT_WHATSAPP`, `e2e/tests/product/help.spec.ts`

### Sibling Sweep
No same-class defect. Registries a new feature must join: cross-tenant core services and actions lists, RLS catalog, i18n namespaces, core domain dependencies (all listed in CLAUDE.md). Check whether `NEXT_PUBLIC_*` vars are validated in the env schema before adding the support number.

### History
`apps/web/lib/shortcuts/*` came with #157 (shell shortcuts); support sessions with #313. No earlier help-center attempt.

### Recommendation
One lane, built in this order: (1) `help_state` table, migration, core `help` domain and registries; (2) shortcut registry duplicate-key test, extended to show surface groups; (3) bundled content, index, search and a small dependency-free markdown renderer; (4) help pages, sheet, tips and coachmarks; (5) support contact tab and member-initiated support request; (6) i18n, e2e specs, docs. Tests and the content lint run locally; e2e, visual and axe run in CI only. The support request needs a schema decision (see contract K3).

### Related Issues
#1 (parent), #159 (dependency, done), #11, #157 (shortcuts), #313 (support sessions), #91 and #92 (out of scope), #502 (the unrelated WhatsApp thread above).
