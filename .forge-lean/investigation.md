**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: P1 feature gap (adoption)
**Task Type**: feature

### What Was Claimed
Onboarding assumes the advocate. A clerk should be able to set up the senior's practice on a phone in Tamil or Kannada; the senior approves with one tap; clerk permissions (no strategy notes) stay unchanged. Depends on #493, which is already on the base (`packages/core/src/court-day/eta.ts`, `board.ts`).

### What We Found
- `apps/web/app/(app)/onboarding/page.tsx:17` is a single "create workspace" card; `actions.ts:26` makes the creator `owner` via `createWorkspaceFor`. No clerk path.
- Invites exist: `packages/core/src/workspaces/invitations.ts:147` `inviteMember` (role clerk allowed, owner never), `:358` `acceptInvitation`; page `apps/web/app/(public)/invite/[token]/page.tsx:36` lands accepted members on `/today` with no setup flow. Invite emails take a `locale` (`invitations.ts:120`).
- Clerk role: `packages/auth/src/roles.ts:46`, matrix `packages/auth/src/policy/matrix.ts:26-28` (clerk may write documents and tasks, read settings; `strategy.read` and `memory.*` need junior, `matter.write` needs junior). Importing and confirming listings are gated elsewhere; the contract tells the implementer to check each against `can()`.
- No approval state exists: `member` (`packages/db/src/schema/auth.ts:~200-220`) has only role and status.
- Tamil and Kannada catalogs exist (`packages/i18n/src/messages/{ta,kn}`); locale is stored per user (`schema/auth.ts:63`) and per workspace (`schema/workspace.ts:29`).
- Import UI: `apps/web/app/(app)/w/[slug]/import`; court-day view at `/today`.

### Root Cause
Product gap: onboarding is advocate-only, and there is no clerk-setup state or senior-approval step.

### Affected Files
`packages/db/src/schema/auth.ts` (member columns) plus a new migration; `packages/core/src/workspaces/clerk-setup.ts` (new); `packages/core/src/workspaces/invitations.ts` (preview/accept return the clerk flag); `apps/web/app/(app)/w/[slug]/welcome/*` (new clerk path); approval banner on the senior's side; i18n `en`, `ta`, `kn`; registries listed in CLAUDE.md.

### Sibling Sweep
Other role-specific first-run paths: none exist. The matrix and `can()` are not touched, so there is no sibling permission change.

### History
Clerk role added with the matrix (#231). Invites in #178 and #180. The wizard is deferred in the comment at `onboarding/page.tsx:11`.

### Recommendation
Implement the senior-invites-clerk path: after accepting a clerk invite, the clerk gets a mobile-first welcome flow (language pick ta/kn/en, import, confirm listings, court-day view) that marks the setup `pending`. The senior sees a one-tap Approve control (owner or advocate, `workspace.manage`). Store the state as nullable columns on `member` (no new table). Defer "clerk starts and invites the senior": a workspace needs an owner, and the clerk must not be given `owner`, which is a product decision.

### Related Issues
#493 (dependency, landed), #509 (activation funnel), #180 and #178 (invites).
