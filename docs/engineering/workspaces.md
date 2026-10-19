# Workspaces and members

A workspace is the tenant unit (PRD §3, PL-1; architecture §6.3). A user can belong to several
workspaces. Switching is hard: no view and no endpoint ever blends data from more than one. Roles
are `owner`, `advocate`, `junior`, `clerk` and `viewer`.

This page covers the data model, the domain service in `@causedeck/core/workspaces`, the server
action rules in `apps/web`, and the members page. #18 was built in five slices:

- #177: data model and service.
- #178: invitations and offboarding.
- #179: workspace context, onboarding and switcher.
- #180: `/invite/[token]`.
- #181: members page and this doc.

## Single source of truth

Workspaces are Better Auth organizations (#12, #153). Better Auth's tables are the only copy. We
extend them in place, with no parallel `workspace` table, no views and no sync:

| Concept | Table (`packages/db/src/schema/auth.ts`) | Added by #177/#178 (migration `0004_workspaces.sql`) |
|---|---|---|
| workspace | `organization` | `slug` as `citext` (unique), `kind` (`solo`/`chamber`), `plan_id`, `created_by`, `deleted_at` |
| member | `member` | `status` (`active`/`suspended`/`removed`), `joined_at`; unique `(workspace_id, user_id)` |
| invitation | `invitation` | `token_hash` (unique), `accepted_at`, `revoked_at` |
| settings | `workspace_settings` (new) | `india_only_ai` (default true), `retention`, `locale`, `timezone` (default `Asia/Kolkata`) |
| old slugs | `workspace_slug_history` (new) | old `slug` (unique) and `expires_at`; redirects live for 90 days |

The rules that follow from this:

- **Use the domain service for writes.** Never write these tables through Better Auth's
  organization endpoints. The service enforces the rules Better Auth does not know about:
  - the last owner cannot be demoted or removed;
  - invitations never grant `owner`;
  - tokens are stored only as hashes;
  - removal runs offboarding.

  The org plugin's role-check hooks (`packages/auth/src/server.ts`) only keep its own endpoints in
  line.
- **Filter every read.** Reads go through `activeMember` and `liveWorkspace`
  (`packages/core/src/workspaces/members.ts`). Suspended and removed members, and soft-deleted
  workspaces, count as "not a member" everywhere: in the API (#14), the shell loader and server
  actions.

## Service API (`@causedeck/core/workspaces`)

Every function takes a `Database | Transaction` first, then validates its input with the zod
schemas in `@causedeck/validators/workspace`. Failures are `WorkspaceError` with a code from the
shared set: `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION` and `RATE_LIMITED`.
`InvitationError` adds a typed `reason`.

| Area | Functions |
|---|---|
| Create, delete | `createWorkspace` (atomic: organization, owner membership, settings; unique slug with a collision suffix; reserved words blocked), `softDeleteWorkspace` (owner-only; sets `deleted_at`; hard delete is #31) |
| Slugs | `slugify`, `generateUniqueSlug`, `renameSlug` (owner-only; writes history), `resolveSlug` (current slug or an old one within 90 days) |
| Reads | `listMemberships`, `listWorkspacesForUser` (keyset pages), `memberRole`, `listMembers` (with `lastActiveAt`), `listPendingInvitations` |
| Roles | `changeRole` (owner-only; last owner is a `CONFLICT`), `prepareOwnershipTransfer` and `transferOwnership` (two steps; step 2 echoes the workspace slug; the old owner becomes `advocate`) |
| Invitations | `inviteMember` (owners invite any non-owner role, advocates invite junior/clerk/viewer; re-inviting an email reissues the token), `reissueInvitation`, `revokeInvitation`, `acceptInvitation` (email must match; distinct `INVALID`/`EXPIRED`/`REVOKED`/`USED`/`EMAIL_MISMATCH`) |
| Offboarding | `removeMember` (owner-only; last owner is a `CONFLICT`). It runs `offboardMember`: reassign open work, delete sessions active in this workspace, mark `removed`, write an audit event. `countOpenWork` tells the UI beforehand whether a reassignment is required |
| Seats | `countBillableSeats` (active members by role, clerks counted separately) and the `entitlements.assertCanAddSeat` gate (permissive by default) |

Under row-level security (#19, [tenancy.md](tenancy.md)) the functions that run before a workspace
is selected scope themselves: `listMemberships`, `listWorkspacesForUser` and `memberRole` open a
`withUser` scope (only the user's own memberships are visible); `createWorkspace` chooses the id and
writes inside `withWorkspace(newId)`; slug generation, rename checks and `resolveSlug(db, slug,
userId)` use SECURITY DEFINER lookups that return only slugs, ids and booleans; `acceptInvitation`
and `previewInvitation` find the workspace by token hash the same way, then work inside its scope.
Every other function expects the caller's workspace-scoped transaction (`ctx.tx`).

Invitation tokens are 32 random bytes (base64url). Only their SHA-256 is stored. They are valid for
7 days and are single-use. Invite and accept are rate limited (20 an hour per actor). Neither
reveals whether an email already has an account.

## Server actions (`apps/web`)

Every action on one workspace uses `workspaceAction` (`apps/web/lib/workspace-action.ts`). It runs
these steps in order:

1. Validate the input with zod.
2. Authenticate with `requireSession`.
3. Load the caller's membership with `memberRole`. A non-member gets `FORBIDDEN` before the handler
   runs.
4. Run the handler on `ctx.tx`, inside `withWorkspace` (see the #19 seam below).

`toActionError` maps a `WorkspaceError` to the matching action error code. The UI shows its own
catalog copy for each code, never the domain message.

Creating a workspace (`/onboarding`) has no workspace yet. It uses `safeAction` with
`requireSession` directly.

## Members page (`/w/[slug]/settings/members`)

The page lives in `apps/web/app/(app)/w/[slug]/settings/members/`:

- **`page.tsx`** (server) loads the context and returns 404 for non-members. It reads members and
  pending invitations on a `withWorkspace` transaction. It streams the list behind a six-row
  skeleton and renders `Could not load members.` with `Try again` when loading fails.
  `?__state=loading|error` previews those two states in development.
- **`members-table.tsx`** (client) renders the layouts:
  - under 768 px, cards with a sticky `Invite member` bar;
  - from 768 px, a table (Member, Role, Status, Last active);
  - from 1280 px, the table plus a `Roles` explainer.

  Pending invitations appear as `Invited` rows. Arrow keys move between table rows, and `Enter`
  opens the row menu.
- **`invite-dialog.tsx`** takes multiple emails as chips, role radio-cards and an optional note.
- **`role-select.tsx`** holds the role pills, the change-role dialog and the two-step ownership
  transfer.
- **`remove-member-dialog.tsx`** lists the consequences. A reassignment is required when the member
  has open work. All three dialogs are loaded on first use.
- **`actions.ts`** holds one `workspaceAction` per operation.

| Who | Sees | Can |
|---|---|---|
| owner | everything | invite any non-owner role, change roles, transfer ownership, remove, resend/revoke invitations |
| advocate | everything | invite junior/clerk/viewer, resend/revoke those invitations; members read-only |
| junior, clerk | the list | nothing (`Only owners can change roles or remove members.`) |
| viewer | the list | nothing (`You can view members but not change them.`) |

These gates are UI only. The domain service checks every one again.

When offline, the page is read-only: the menus are disabled and `Invite member` shows
`Needs a connection`. Role pills use the semantic soft tokens: owner `--seal`, advocate
`--accent-soft`, junior `--info-soft`, clerk `--warning-soft`, viewer neutral.

Invitation emails go through the auth `Mailer` (`createMailer`). Dev and CI use the console
transport (or Mailpit with `EMAIL_PROVIDER=smtp`). In those environments the action also returns
the invite link, so the success toast can offer `Copy link`. It never returns the link in
production or with `EMAIL_PROVIDER=ses`.

Tests:

- Unit: `apps/web/__tests__/members-page.test.tsx`, `members-actions.test.ts`,
  `packages/core/src/workspaces/__tests__/members-listing.test.ts`.
- e2e and axe: `e2e/tests/workspaces/members.spec.ts`.
- Visual baselines (360/768/1280, light and dark): `members.visual.spec.ts`.

## Seams for later issues

| Issue | Seam | Today |
|---|---|---|
| #19 RLS | `withWorkspace(db, { workspaceId, userId }, fn)` sets `app.workspace_id` and `app.user_id` for one transaction. Handlers and page loads use `ctx.tx` / that transaction only | FORCE RLS is on (`0006_rls_baseline`); a query outside a scope sees no tenant rows. The cross-tenant suite and CI gate are #19 part 2 |
| #20 `can()` | `INVITABLE_ROLES` in `invitations.ts`, owner-only checks in `members.ts`, the local `can()` in `apps/web/lib/workspace-context.ts` and `INVITABLE` in `role-select.tsx` | Replace them with the central policy (including the per-workspace "advocates may invite" setting) |
| #23 email | `Mailer` (`@causedeck/auth/mailer`) with template `workspace.invitation` | Console/Mailpit transports. #23 adds the SES transport and the real template. The invite dialog's optional note is collected but not yet sent, because the template has no field for it |
| #25 settings | The settings shell and its section navigation (the Settings nav item opens the `settings` index placeholder) | The members page is reachable by URL until #25 links it from the settings sections |
| #26 audit | `AuditSink` / `setAuditSink` in `offboarding.ts` (`member.removed` events) | No-op sink by default |
| #28 billing | `countBillableSeats`, and `Entitlements` / `setEntitlements` (`assertCanAddSeat` is called before every invite and accept) | Permissive default |
| tasks, obligations | `registerReassignProvider({ countOpen, reassign })` in `offboarding.ts` | No providers yet, so removal never needs a reassignment |
