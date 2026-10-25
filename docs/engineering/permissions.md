# Permissions

Generated from `packages/auth/src/policy/matrix.ts` by `pnpm docs:permissions`. Do not edit by
hand; CI fails when this file is stale.

`can(actor, action, resource?, settings?)` in `@causedeck/auth` is the one permission decision.
It is pure and denies by default; Postgres RLS is the backstop. ✓ means the role is allowed by
the matrix, before the resource checks below.

## workspace

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `workspace.manage` | ✓     | ✓        | —      | —     | —      |
| `workspace.rename` | ✓     | —        | —      | —     | —      |
| `workspace.delete` | ✓     | —        | —      | —     | —      |

## member

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `member.invite` | ✓     | ✓        | —      | —     | —      |
| `member.remove` | ✓     | —        | —      | —     | —      |
| `member.role` | ✓     | —        | —      | —     | —      |

## billing

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `billing.manage` | ✓     | —        | —      | —     | —      |
| `billing.read` | ✓     | —        | —      | —     | —      |
| `invoices.read` | ✓     | —        | —      | —     | —      |

## matter

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `matter.read` | ✓     | ✓        | ✓      | ✓     | ✓      |
| `matter.write` | ✓     | ✓        | ✓      | —     | —      |
| `matter.restrict` | ✓     | ✓        | —      | —     | —      |

## strategy

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `strategy.read` | ✓     | ✓        | ✓      | —     | —      |

## memory

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `memory.read` | ✓     | ✓        | ✓      | —     | —      |
| `memory.write` | ✓     | ✓        | ✓      | —     | —      |

## document

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `document.read` | ✓     | ✓        | ✓      | ✓     | ✓      |
| `document.write` | ✓     | ✓        | ✓      | ✓     | —      |

## task

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `task.read` | ✓     | ✓        | ✓      | ✓     | ✓      |
| `task.write` | ✓     | ✓        | ✓      | ✓     | —      |

## listing

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `listing.read` | ✓     | ✓        | ✓      | ✓     | ✓      |

## draft

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `draft.read` | ✓     | ✓        | ✓      | —     | —      |
| `draft.write` | ✓     | ✓        | ✓      | —     | —      |
| `draft.export` | ✓     | ✓        | ✓      | —     | —      |

## audit

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `audit.read` | ✓     | ✓        | —      | —     | —      |

## export

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `export.run` | ✓     | —        | —      | —     | —      |

## support

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `support.manage` | ✓     | —        | —      | —     | —      |

## shell

| Action | owner | advocate | junior | clerk | viewer |
| ------ | ----- | -------- | ------ | ----- | ------ |
| `limitation.read` | ✓     | ✓        | ✓      | —     | —      |
| `insights.read` | ✓     | ✓        | —      | —     | —      |
| `settings.read` | ✓     | ✓        | ✓      | ✓     | —      |

## Settings and resource rules

- `advocatesCanInvite` (default true): when false, advocates are denied `member.invite`
  (workspace_settings.advocates_can_invite).
- `advocatesCanReadAudit` (default true): when false, advocates are denied `audit.read`
  (workspace_settings.advocates_can_read_audit).
- Restricted matters: only users in `restricted.allowUserIds` may act on them, plus owners
  while `ownersSeeRestrictedMatters` is true (the default;
  workspace_settings.owners_see_restricted).
- Juniors act on a matter only when it is assigned to them, shared with them (allow list) or
  owned by them.

## Deny reasons

- `ROLE_DENIED`: the role is below the action’s minimum, or the action is unknown.
- `RESTRICTED_MATTER`: the matter is restricted and the user is not on its allow list.
- `CROSS_WORKSPACE`: the resource belongs to another workspace (checked first, for every role).
- `NOT_ASSIGNED`: a junior acting on a matter not assigned to, shared with or owned by them.
- `FEATURE_OFF`: the action’s domain is switched off for the workspace.
- `SUSPENDED`: the member is suspended.
- `STAFF_READ_ONLY`: platform staff in a support session may never write (every action other than `.read`).

## Enforcement

Every server action and `/v1` route authorizes: a server action goes through
`workspaceAction` / `guard` (apps/web/lib) or calls `assertCan`; a `/v1` route lists
`authorize(action)` in its `middleware`. The ESLint rule `causedeck/require-authorization`
(packages/config/eslint) fails any that does not, unless it is annotated
`// authz: public <reason>`, which reviewers check like any other exception.
