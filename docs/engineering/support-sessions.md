# Support sessions

Consented, time-boxed, read-only support access to one workspace (#27: #308 core, #313 owner side,
#314 staff side; spike §6, PRD PL-6, architecture §6.3). Staff see no customer content by default.
A workspace owner grants a session, it runs out, and everything staff look at during it is audited.

## Policy

- **Who requests.** Only enabled platform staff (`staff_user` with `disabled_at` null) in the
  `support` or `admin` role ([admin-console.md](admin-console.md#staff-roles)). Staff accounts exist
  only through the operator CLI. Disabling a staff member ends every one of their sessions at once
  (`endStaffSupportSessions`).
- **A reason is required**, 1 to 500 characters (`SUPPORT_REASON_MAX_LENGTH`, a CHECK too). The
  owner reads it before deciding.
- **Scope.** `view`, a read-only view of workspace content, is the default. `metadata` (plan and
  usage details) never reaches content.
- **Who decides.** Only a workspace owner grants (1 to 240 minutes, default 60), denies or revokes.
  The requesting staff member may end or withdraw their own session. Nobody else can do either.
- **No extension.** Only a `requested` session can be granted. Once a session is granted, denied,
  expired or ended, more time needs a new request and a new grant.
- **Read-only.** Content is reachable only through `ctx.supportSession` from `withSupportSession`
  (`packages/core/src/support/access.ts`):
  - `read(action, targets, fn)` re-checks the session on every call, so revocation and expiry take
    effect at once. It then checks `can()` for the staff actor (advocate-level reads, never
    restricted matters) and runs `fn` on a savepoint that is always rolled back.
  - `can()` denies every write for `kind: 'staff'` (`STAFF_READ_ONLY`), and every denial is audited.
- **Expiry.** An elapsed `expires_at` counts as inactive straight away. The
  `system.support.session-expire` job then flips the row to `expired`.

## Flow

1. **Staff request.** Admin console, Support sessions (`apps/admin/app/(console)/support/page.tsx`):
   enter the workspace ID, the access and the reason. A slug or name search arrives with the
   workspace lookup (#310), and `?workspace=<id>` prefills the field. `requestSupportSessionAction`
   calls `requestSupportSessionFor`.
2. **Owner notified.** Every active owner gets a `security.alert` in the product, written in the
   request's own transaction, plus an email once the request commits.
3. **Owner decides.** In the product, Settings, Support access
   (`apps/web/app/(app)/w/[slug]/settings/support`), the owner picks `Grant for 1 hour` (or another
   length up to 4 h), `Deny` or `Revoke now`. While a session is active, the product shell shows
   `Support is viewing this workspace until 14:30` with a one-click `End session`.
4. **Staff view.** The session page (`apps/admin/app/(console)/support/[id]/page.tsx`) shows the
   state:
   - While active, it shows a banner with a live countdown and `End session`.
   - For a `view` session, it also shows the workspace profile and members (no emails), read
     through `readSupportWorkspaceView`, under a fixed `--danger-soft` `SUPPORT SESSION: READ-ONLY`
     bar. The bar is a polite live region, announced when the view opens and at 5 and 1 minutes
     left.
   - The page re-reads the session on every load, so a revoke or expiry drops the view.
   - Someone else's session, or an unknown id, gets the generic 404.
5. **End.** The owner's `Revoke now` or banner `End session`, the staff member's `End session`, the
   expiry job, or disabling the staff member.

A staff member's own sessions are read from a user scope (`withUser`). There, only the `staff_self`
RLS policy (migration 0026) exposes rows: `listStaffSupportSessions` / `staffSupportSession`. Staff
never use `withoutWorkspace` for sessions.

## Audit events

All carry actor kind `staff` and land in the workspace's audit chain ([audit.md](audit.md)).

| Event | When | Metadata |
|---|---|---|
| `support.session_started` | the owner grants (`grantSession`) | target `support_session` |
| `support.session_ended` | a granted session ends | `endReason`: `revoked` (owner or staff), `expired` (job), `staff_disabled` |
| `support.view` | every content read through `ctx.supportSession.read` | `supportSessionId`, `readAction`, `targetKinds`, `targetIds` (ids only, never content) |
| `access.denied` | a write attempt, or a content read in a `metadata` session | `reason` (`STAFF_READ_ONLY`, `SUPPORT_SCOPE_METADATA`), `supportSessionId`; outcome `denied` |

A pending request that is withdrawn or denied was never a session, so it writes no end event. The
request itself is the `support_session` row and the owners' notifications.

## Tests

- `packages/core/src/support/__tests__/support.test.ts`: lifecycle, read-only context, staff
  console reads.
- `apps/admin/__tests__/support-pages.test.tsx`: staff pages and actions.
- `e2e/tests/admin/support-session.spec.ts`: the lifecycle across both apps (request, grant, deny,
  revoke, expiry, staff end).
- `e2e/tests/settings/support-session.spec.ts`: the owner side.
