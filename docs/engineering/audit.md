# Audit log

`audit_event` is the security and administrative audit log (#26). It is append-only and
tamper-evident, isolated per workspace, and holds no privileged content. This page covers the
TypeScript writer in `@causedeck/core` (#227, #26 part 2). The tables, grants and SQL chain function
are in [database.md](database.md#audit-tables) (#226, migration `0008_audit`). Later parts extend
this page.

```sh
pnpm --filter @causedeck/core exec vitest run src/audit          # writer, chain, redaction, ai_call
AUDIT_BENCH=1 pnpm --filter @causedeck/core exec vitest run src/audit/__tests__/writer.bench.test.ts
```

## Layout

| Path                                  | What                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/audit/events.ts`   | `AUDIT_ACTIONS` registry, `AuditAction`, `AuditEventInput`, `AuditContext`                                        |
| `packages/core/src/audit/writer.ts`   | `record(ctx, input)`                                                                                              |
| `packages/core/src/audit/redact.ts`   | `assertRedacted`, `AUDIT_BANNED_METADATA_KEYS`, `hashUserAgent`, `truncateIpForDisplay`                           |
| `packages/core/src/audit/chain.ts`    | `verifyChain(db, workspaceId, range)`                                                                             |
| `packages/core/src/audit/sink.ts`     | `recordAuditSink`, the default `AuditSink` behind `offboardMember` (`member.removed`)                             |
| `packages/core/src/audit/ai-call.ts`  | `ai_call` writer contract for the AI gateway (#44): `AiCallInput`, `recordAiCall`                                 |

Everything is exported from `@causedeck/core` and `@causedeck/core/audit`.

## Event taxonomy

Every action is named in `AUDIT_ACTIONS`. `record()` rejects an action that is not registered.
Each action is either **security** or **informational**:

| Kind          | Failed write                                                                      | IP stored |
| ------------- | --------------------------------------------------------------------------------- | --------- |
| security      | fail-closed: `record()` throws, so the action fails and its transaction rolls back | yes       |
| informational | fail-open: logged (`service: audit`, action, workspace and error code only) and dropped. The write ran on its own savepoint, so the caller's transaction stays usable | no        |

| Action                      | Kind          | Emitted by                                      |
| --------------------------- | ------------- | ----------------------------------------------- |
| `member.removed`            | security      | `offboardMember` through the `AuditSink`        |
| `member.role_changed`       | security      | role change (#228)                              |
| `flag.changed`              | security      | flag admin (#228; `@causedeck/flags` sink, #22) |
| `workspace.settings_viewed` | informational | reserved                                        |

#228 adds the sign-in, magic link, passkey, 2FA, session, export, support session and access-denied
actions.

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
  shows it (#232). Exports leave the IP out unless the exporter is an owner (#229).

## record()

```ts
await record(
  { db: tx, workspaceId, actor: { userId, kind: 'user' }, requestId, userAgent, ip },
  { action: 'member.role_changed', target: { kind: 'member', id: memberId }, metadata: { to: 'clerk' } },
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

`verifyChain(db, workspaceId, { from?, to? })` recomputes every hash in SQL with the same function
and checks each `prev_hash` against the previous event's hash. It returns
`{ ok, checked, brokenAt?: { id, reason: 'hash' | 'link' } }`:

- An edited row is reported as `hash`.
- An edited row whose hash was also recomputed breaks the next row's `link`.
- A whole chain must start with a `null` `prev_hash`. A range starting at `from` takes its first
  `prev_hash` as given.

Account chains are verified by the nightly job (#230).

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

| Field                                         | Notes                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `purpose`, `provider`, `model`, `modelVersion`, `region` | What ran, where (data residency)                                 |
| `inputTokens`, `outputTokens`, `costPaise`    | Non-negative (CHECK `ai_call_usage_chk`)                                    |
| `sources`                                     | `{ id, anchor? }[]` only. Any other key (such as a quote) is rejected       |
| `confidence`                                  | 0-1, stored to three decimals                                               |
| `automationLevel`                             | `1 \| 2 \| 3 \| 4`. L5 is rejected by the writer and by CHECK `ai_call_automation_level_chk` |
| `autoApplied`, `userAction`, `userId`         | `userAction` is what the user did with the output                           |

`ai_call` is append-only. Record a later user action or an undo as a new row, never as an update.
A breach of the contract throws `AiCallContractError`.
