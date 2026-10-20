# Audit log

`audit_event` is the security and administrative audit log (#26). It is append-only and
tamper-evident, isolated per workspace, and holds no privileged content. This page covers the
TypeScript writer in `@causedeck/core` (#227, #26 part 2). The tables, grants and SQL chain function
are in [database.md](database.md#audit-tables) (#226, migration `0008_audit`). Later parts extend
this page.

```sh
pnpm --filter @causedeck/core exec vitest run src/audit          # writer, chain, redaction, ai_call, query, export
pnpm --filter @causedeck/web exec vitest run app/api/audit        # export route and download token
AUDIT_BENCH=1 pnpm --filter @causedeck/core exec vitest run src/audit/__tests__/writer.bench.test.ts
```

## Layout

| Path                                     | What                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/core/src/audit/events.ts`      | `AUDIT_ACTIONS` registry, `AuditAction`, `AuditEventInput`, `AuditContext`                      |
| `packages/core/src/audit/writer.ts`      | `record(ctx, input)`                                                                            |
| `packages/core/src/audit/redact.ts`      | `assertRedacted`, `AUDIT_BANNED_METADATA_KEYS`, `hashUserAgent`, `truncateIpForDisplay`         |
| `packages/core/src/audit/chain.ts`       | `verifyChain(db, workspaceId, range)`                                                           |
| `packages/core/src/audit/sink.ts`        | `recordAuditSink`, the default `AuditSink` behind `offboardMember` (`member.removed`)           |
| `packages/core/src/audit/ai-call.ts`     | `ai_call` writer contract for the AI gateway (#44): `AiCallInput`, `recordAiCall`               |
| `packages/core/src/audit/query.ts`       | `authorizeAuditRead`, `queryAudit` (activity feed, #229)                                        |
| `packages/core/src/audit/export.ts`      | `exportAudit`, `AUDIT_EXPORT_COLUMNS` (CSV / JSON Lines stream, #229)                           |
| `apps/web/app/api/audit/export/route.ts` | Signed-link download of the export (#229); token helper in `apps/web/lib/audit-export-token.ts` |

Everything is exported from `@causedeck/core` and `@causedeck/core/audit`.

## Event taxonomy

Every action is named in `AUDIT_ACTIONS`. `record()` rejects an action that is not registered.
Each action is either **security** or **informational**:

| Kind          | Failed write                                                                                                                                                          | IP stored |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| security      | fail-closed: `record()` throws, so the action fails and its transaction rolls back                                                                                    | yes       |
| informational | fail-open: logged (`service: audit`, action, workspace and error code only) and dropped. The write ran on its own savepoint, so the caller's transaction stays usable | no        |

| Action                                | Kind          | Emitted by                                                                                                                 |
| ------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `member.removed`                      | security      | `offboardMember` through the `AuditSink`                                                                                   |
| `member.role_changed`                 | security      | `changeRole`, `transferOwnership` (both roles)                                                                             |
| `flag.changed`                        | security      | `flagChangeAuditSink` for `setFlagAuditSink` (#22)                                                                         |
| `auth.sign_in`                        | security      | Better Auth `databaseHooks.session.create`                                                                                 |
| `auth.sign_in_failed`                 | security      | `hooks.after`: magic-link, passkey, 2FA verify                                                                             |
| `auth.magic_link_requested`           | security      | `hooks.after`: `/sign-in/magic-link`                                                                                       |
| `auth.passkey_added`                  | security      | `hooks.after`: `/passkey/verify-registration`                                                                              |
| `auth.passkey_removed`                | security      | `hooks.after`: `/passkey/delete-passkey`                                                                                   |
| `auth.two_factor_enabled`             | security      | `databaseHooks.user.update` (`/two-factor/*`)                                                                              |
| `auth.two_factor_disabled`            | security      | `databaseHooks.user.update` (`/two-factor/disable`)                                                                        |
| `auth.session_revoked`                | security      | `databaseHooks.session.delete` (revoke paths)                                                                              |
| `audit.exported`                      | security      | `exportAudit`, before the first byte (#229); `recordExportRun`                                                             |
| `support.session_started`             | security      | `recordSupportSessionStarted` (#27)                                                                                        |
| `support.session_ended`               | security      | `recordSupportSessionEnded` (#27)                                                                                          |
| `access.denied`                       | security      | web `guard`/`workspaceAction`, api `requireWorkspace`/`authorize`                                                          |
| `staff.read` | security | admin data layer `staffQuery`, before the read (#309) |
| `staff.two_factor_verified` | security | admin console TOTP step (`verify-2fa`, #309) |
| `usage.budget_override_set`           | security      | `setBudgetOverride` (`@causedeck/core/usage`, #220)                                                                        |
| `usage.budget_override_expired`       | security      | `expireBudgetOverride` (#224); metadata `key`, `expired_at`                                                        |
| `billing.subscription_changed`        | security      | owner billing actions (`changeSubscription`, #257)                                                                         |
| `billing.gstin_updated`               | security      | `setSubscriptionGstin` (#257)                                                                                              |
| `billing.invoice_downloaded`          | security      | `openSaasInvoicePdf`, before the first byte (#258)                                                                         |
| `workspace.role_settings_updated`     | security      | `updateRoleSettings` (#285)                                                                                                |
| `workspace.privacy_updated`           | security      | `updateWorkspacePrivacy` (#286)                                                                                            |
| `workspace.integration_token_rotated` | security      | `rotateIntegrationToken` (#287; metadata `kind` only)                                                                      |
| `workspace.deletion_requested` | security | `requestWorkspaceDeletion` (#302); metadata: job id, cool-off end |
| `workspace.deletion_cancelled` | security | `cancelWorkspaceDeletion` (#302); metadata: job id |
| `workspace.deletion_started` | security | `runWorkspaceErase`, before step 1 (system actor, #302) |
| `workspace.settings_viewed`           | informational | reserved                                                                                                                   |
| `account.profile_updated`             | informational | `/account` `updateAccountProfileAction` via `recordAccountProfileUpdatedFor` (account-level; metadata `fields` only, #289) |
| `audit.retention_purged`              | security      | `system.audit.retention` (account chain, #230)                                                                             |

Workspace deletion (#302) purges the workspace's own chain (`audit_event` and `ai_call` rows) in
the final erase step, through `app_finalize_workspace_deletion`, after the chain head hash has been
captured in the signed deletion receipt kept on `deletion_tombstone`. See
[data-lifecycle.md](data-lifecycle.md).

Security events (#228):

- Auth events reach `record()` through the `SecurityEventRecorder` that `@causedeck/auth`
  `createAuth` takes as `securityEvents` (core depends on auth, so auth only defines the interface;
  `createSecurityEventRecorder(db)` in `@causedeck/core/audit` implements it, injected in
  `apps/web/lib/auth.ts` and `apps/api/src/server.ts`). They are account-level (`workspaceId: null`).
  Magic-link requests and failed sign-ins carry an `emailHash` (sha256 of the trimmed, lowercased
  address), never the email. A magic-link request is recorded for known and unknown addresses alike,
  and a request rejected by the per-email rate limit is not recorded. A failed sign-in that cannot be
  recorded is logged, so the original auth error still reaches the client.
- `access.denied` is written by `recordAccessDenied` in a fresh transaction on the root `db`, so it
  survives the denied action's rolled-back transaction, and a failed write is logged, never masking
  the original `FORBIDDEN`. A member's denial goes to the workspace chain; a non-member's is
  account-level (target `workspace`), so a non-member never writes into a chain it cannot read.
- `flag.changed` stores the old and new values and whether a legal acknowledgement was given
  (`legalAck`); the free-text legal note is never stored.

Three errors are always thrown, whatever the action kind: an unknown action, content-bearing
metadata (`AuditRedactionError`), and a tenancy violation (`TENANCY_VIOLATION`).

## What is and is not recorded

Recorded: the actor (`actor_user_id`, `actor_kind`: `user`, `staff`, `system`, `api`), the action,
the target (`target_kind`, `target_id`), the outcome (`success` by default, `denied`, `error`), the
request id, the sha256 hex of the user agent, and flat metadata of identifiers and flags.

Not recorded:

- Matter content. Metadata is a flat map of strings, numbers, booleans and `null`. Keys `content`,
  `text`, `quote`, `body`, `prompt` and `transcript` (in any case) are rejected, and so are nested
  objects and arrays.
- The raw user agent. Only its hash is stored.
- The IP of informational events. Security events store `ctx.ip` in `ip inet`. For display, call
  `truncateIpForDisplay`, which gives the `/24` for IPv4 and the `/48` for IPv6. The Activity tab
  shows it (#232). The feed and exports leave the IP out unless the reader is an owner (see
  [Export](#export)).

## Reading: the audit.read permission

The feed and the export are gated by `audit.read`, checked by `authorizeAuditRead(ctx)` with the
central policy (`can()` in `@causedeck/auth/policy`) and the workspace setting
`workspace_settings.advocates_can_read_audit` (default true):

| Role                  | `audit.read`                                           |
| --------------------- | ------------------------------------------------------ |
| owner                 | always                                                 |
| advocate              | unless an owner sets `advocates_can_read_audit` false  |
| junior, clerk, viewer | never (`FORBIDDEN`)                                    |
| not an active member  | `NOT_FOUND` (also a missing or soft-deleted workspace) |

The check takes no row locks. Staff get no content through it; events hold no content anyway.

## Query

`queryAudit({ db, workspaceId, userId }, filters)` returns `{ events, nextCursor }`, newest first
(`created_at desc, id desc`). Filters:

- `from` (inclusive) and `to` (exclusive) on `created_at`.
- `actorUserId`.
- `actionGroup`: an action or its prefix before a dot (`member` matches `member.removed` and
  `member.role_changed`).
- `limit`: 1 to 200, default 50.
- `cursor`: the previous page's `nextCursor`, an opaque base64url keyset position
  (`created_at` to the microsecond and `id`). A malformed cursor is `VALIDATION`.

Each event has `id`, `createdAt`, `actorUserId`, `actorKind`, `action`, `targetKind`, `targetId`,
`outcome`, `requestId`, `userAgentHash`, `metadata` and `hash` (hex). Owners also get `ip`, truncated
by `truncateIpForDisplay`; for anyone else the key is absent. The raw user agent is never returned.

## Export

`exportAudit(ctx, { from, to, format: 'csv' | 'jsonl', bom?, actorUserId?, actionGroup? })` resolves
to a `ReadableStream<Uint8Array>` of `from` (inclusive) to `to` (exclusive), oldest first. Before it
resolves it checks `audit.read` and records `audit.exported` (metadata `{ format, from, to }`, no
filter values). That event is security, so if it cannot be written the export fails before any
byte. The stream then fetches one keyset page of 1,000 rows per pull, each in its own
`withWorkspace`, so at most one page is held in memory whatever the range (the test exports 100,000
rows with under 64 MB of heap growth).

Columns, in order (`AUDIT_EXPORT_COLUMNS`):

| Column            | Value                                           |
| ----------------- | ----------------------------------------------- |
| `id`              | event uuid                                      |
| `created_at`      | ISO 8601 UTC, microseconds                      |
| `actor_user_id`   | uuid or empty                                   |
| `actor_kind`      | `user`, `staff`, `system`, `api`                |
| `action`          | registered action                               |
| `target_kind`     | or empty                                        |
| `target_id`       | or empty                                        |
| `outcome`         | `success`, `denied`, `error`                    |
| `request_id`      | or empty                                        |
| `user_agent_hash` | sha256 hex of the user agent, or empty          |
| `metadata`        | compact JSON                                    |
| `hash`            | chain hash, hex                                 |
| `ip`              | owners only: truncated (`/24`, `/48`), or empty |

- **CSV**: a header row of the column names, RFC 4180 quoting (fields with `,`, `"`, CR or LF are
  quoted, inner quotes doubled), CRLF line ends. `bom: true` prefixes a UTF-8 BOM (EF BB BF) for
  Excel. A cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`, so a spreadsheet does
  not run it as a formula.
- **JSON Lines**: one JSON object per row with the same keys, `\n`-terminated, never a BOM.

### Download route

`apps/web/app/api/audit/export/route.ts` serves the export in two steps:

1. `POST /api/audit/export` with `{ workspaceId, from, to, format, bom? }`: same-origin only (403),
   signed in (401), a member (`guard`, 403), and `authorizeAuditRead` (403 forbidden, 404 not a
   member); a bad body is 400. It returns `{ url, expiresAt }` (`Cache-Control: no-store`).
2. `GET /api/audit/export?token=…`: the token must verify, be unexpired and belong to the signed-in
   user (else 401 `invalid_token`). `exportAudit` re-checks the permission (403 or 404) and the
   stream is returned unbuffered with `Content-Disposition: attachment;
filename="audit-<from>-<to>.<csv|jsonl>"`, `Cache-Control: no-store` and
   `X-Content-Type-Options: nosniff`.

The token is `base64url(payload) "." base64url(HMAC-SHA256)`, keyed by
`HMAC-SHA256(BETTER_AUTH_SECRET, 'causedeck:audit-export:v1')`. The payload holds the workspace,
user, range, format, BOM flag and expiry, and it is valid for 60 s (`EXPORT_TOKEN_TTL_MS`).

## record()

```ts
await record(
  { db: tx, workspaceId, actor: { userId, kind: 'user' }, requestId, userAgent, ip },
  {
    action: 'member.role_changed',
    target: { kind: 'member', id: memberId },
    metadata: { to: 'clerk' },
  },
);
```

- **Workspace events** are written in the caller's transaction, so they commit or roll back with
  the action. When `db` is a transaction already scoped to that workspace (`withWorkspace`, as server
  actions are), a security event costs one statement, and an informational event adds a savepoint.
  Otherwise `record()` opens a `withWorkspace` savepoint itself. Passing another workspace's id
  inside a workspace scope throws `TENANCY_VIOLATION`.
- **Account-level events** (`workspaceId: null`) are written in a transaction of their own (a
  savepoint when `db` is already a transaction) on the account chain. Their actor reads them
  through the `account_self` policy while no workspace is pinned.
- All rows go through `app_audit_append()`. The app role cannot insert into `audit_event` directly,
  and it cannot update or delete a row.

## Chain format

There is one chain per workspace, plus one account chain. `app_audit_append()` takes a transaction
advisory lock on the chain, reads the latest `hash` as `prev_hash`, and stores:

```
hash = sha256(coalesce(prev_hash, '') || convert_to(app_audit_canonical(event)::text, 'UTF8'))
```

`app_audit_canonical` is the jsonb (sorted keys) of every column except `prev_hash` and `hash`, with
`created_at` in UTC to the microsecond and `ip` as `host(ip)`. `audit_event_chain_uq` (unique
`(workspace_id, prev_hash)`, nulls not distinct) makes a fork impossible to store.

**Actor reference (0031, #303).** Every event with a user actor also stores `actor_ref`: the hex
`sha256(salt || uuid bytes)` of `actor_user_id`, with a per-user salt in `audit_actor_salt`. That
table is global and owner-only: the app and clerk roles have no privileges on it. When `actor_ref`
is set, the canonical form contains `actor_ref` in place of `actor_user_id`; events with no user
actor keep the 0008 form. Migration 0031 first verified every chain and refused to run over a broken
one. It then backfilled `actor_ref` on the legacy rows and recomputed every chain's hashes once, in
chain order.

**Anonymisation.** `app_audit_anonymise_actor(user)` (SECURITY DEFINER) works only once the `user`
row is gone, so it runs in the account-deletion transaction. It nulls `actor_user_id` in every
chain and deletes the user's salt. `app_audit_immutable` allows exactly that update (`actor_user_id`
to null on a row with `actor_ref`, nothing else changed) while the transaction-local
`app.audit_anonymise` is `on`. Every other update is still rejected.

`verifyChain(db, workspaceId, { from?, to? })` recomputes every hash in SQL with the same function
and checks each `prev_hash` against the previous event's hash. It returns
`{ ok, checked, brokenAt?: { id, reason: 'hash' | 'link' | 'actor' } }`:

- An edited row is reported as `hash`.
- A row whose `actor_user_id` no longer matches its `actor_ref` is reported as `actor`
  (`app_audit_actor_ref_matches`). An anonymised row (`actor_user_id` null) passes.
- An edited row whose hash was also recomputed breaks the next row's `link`.
- A whole chain must start with a `null` `prev_hash`. A range starting at `from` takes its first
  `prev_hash` as given.

Account chains are verified by the nightly job through `app_audit_verify_account_chain` (see
below).

## Verification and retention

Two jobs keep the chains checked and trimmed (#230, [jobs.md](jobs.md#audit-jobs)):

- **Nightly verification.** `system.audit.verify` runs at 02:00 IST. It verifies the account chain
  through the owner-defined `app_audit_verify_account_chain(from, to)` (`0019_audit_jobs`; the
  app role can read account events only as their actor). It then enqueues `audit.verify` for every
  workspace listed by `app_audit_chain_targets()`, deleted workspaces included. Each run starts
  `from` the epoch, so a chain whose oldest events were purged is verified from its oldest
  surviving row; every surviving row's hash is still checked.
- **Mismatch alert.** A broken chain logs at `fatal` with message and `event`
  `audit.chain_mismatch`, `severity: 'critical'`, `workspaceId` (null for the account chain),
  `eventId` (the first broken event), `reason` (`hash`, `link` or `actor`) and `checked`. Metadata and row
  content are never logged. The job does not fail, so it does not retry and re-alert.
- **Retention.** `system.audit.retention` runs at 03:00 IST. CERT-In requires logs to be kept in
  India for at least 180 days, so the window (`retentionDays`) is at least 180 and defaults to 400.
  The payload schema, the handler and the purge functions each refuse less. Audit events and
  `ai_call` rows older than the window are deleted only through `app_purge_audit` and
  `app_purge_ai_calls`.
- **Summary row.** In the same transaction the job records `audit.retention_purged` (security,
  fail-closed) on the account chain, with actor kind `system` and metadata `retentionDays`,
  `cutoff` (ISO, UTC), `auditDeleted` and `aiCallsDeleted`. A failed summary rolls the purge back.

## Performance budget

The target is that audit writes add < 5 ms p95 to a server action on seeded data.
`writer.bench.test.ts` measures it and runs only when `AUDIT_BENCH=1`. It runs committed
transactions on a chain of 1,000 events with current statistics.

The budget is not met yet. `app_audit_append` finds the chain head with
`workspace_id IS NOT DISTINCT FROM ...`, which cannot use `audit_event_workspace_id_idx`, so each
append scans and sorts the whole chain: about 2.6 ms in the database at 1,000 events, growing
linearly. Making the lookup index-driven needs a migration, which is a tracked follow-up of #227.

## ai_call writer contract (#44)

The AI gateway records every model call with
`recordAiCall(tx, workspaceId, input: AiCallInput)`, inside its workspace transaction. It returns
`{ id }`. Fields (PRD TR-3):

| Field                                                    | Notes                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `purpose`, `provider`, `model`, `modelVersion`, `region` | What ran, where (data residency)                                                             |
| `inputTokens`, `outputTokens`, `costPaise`               | Non-negative (CHECK `ai_call_usage_chk`)                                                     |
| `sources`                                                | `{ id, anchor? }[]` only. Any other key (such as a quote) is rejected                        |
| `confidence`                                             | 0-1, stored to three decimals                                                                |
| `automationLevel`                                        | `1 \| 2 \| 3 \| 4`. L5 is rejected by the writer and by CHECK `ai_call_automation_level_chk` |
| `autoApplied`, `userAction`, `userId`                    | `userAction` is what the user did with the output                                            |

`ai_call` is append-only. Record a later user action or an undo as a new row, never as an update.
A breach of the contract throws `AiCallContractError`.
