# Data lifecycle: workspace export and deletion

DPDP data lifecycle (#31, PRD PL-8). This page covers part 1, workspace export (#301): the lifecycle
tables, the exporter registry, the streaming ZIP and its download; and part 2, workspace deletion
(#302): the cool-off, the ordered crypto-erase, the receipt and tombstone, statutory retention and
the SLAs. Account and memory erasure (#303), step-up authentication (#304) and the UI (#305) extend
it. Operations: [infra/runbooks/workspace-deletion.md](../../infra/runbooks/workspace-deletion.md).

```sh
pnpm --filter @causedeck/core exec vitest run src/lifecycle      # export, coverage, cross-tenant, privacy, memory (64 MB)
pnpm test:export-coverage                                         # completeness gate (CI: tenancy job)
EXPORT_MEMORY_TEST=1 pnpm --filter @causedeck/core exec vitest run src/lifecycle/__tests__/export.memory.test.ts  # 2 GB run
pnpm --filter @causedeck/storage exec vitest run src/__tests__/stream.test.ts
pnpm --filter @causedeck/web exec vitest run app/api/exports
pnpm --filter @causedeck/core exec vitest run src/lifecycle/__tests__/{deletion,cooloff,crypto-erase,receipt,legal-hold,purge-coverage}.test.ts
```

## Tables (`0025_lifecycle`)

| Table                | Scope                                                       | Notes                                                                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export_job`         | tenant, FORCE RLS                                           | `scope` `workspace` or `user`; `status` `queued`, `running`, `ready`, `failed`, `expired`; `progress` 0 to 100; `steps` checkpoints; `blob_id`, `size_bytes`, `sha256` of the plaintext ZIP; `download_token_hash`; `expires_at`. One queued or running export per requester and workspace. |
| `deletion_job` | tenant, FORCE RLS, `workspace_id` null for account deletion | `kind` `workspace` (#302), `account` and `memory` (#303); `status`, `cooloff_until`, `erase_after`, `steps` checkpoints. One pending, scheduled or running workspace deletion per workspace (`deletion_job_workspace_active_uq`, 0031). |
| `deletion_tombstone` | global (`GLOBAL_TABLES`) | Minimal record of an erased workspace with its signed `receipt` (0031) and `receipt_hash`. No foreign key, so it outlives the purge; the app and clerk roles cannot update or delete it. |
| `legal_hold_invoice` | global (`GLOBAL_TABLES`, 0031) | Minimal statutory copy of an erased workspace's issued, paid and void SaaS invoices (`legal_hold = true`, `retain_until`). No foreign key; write-once for the app and clerk roles. |

`app_export_due_jobs(now)` is an owner-defined function returning only the ids of ready exports past
their expiry, for the system expiry job. `app_deletion_due_jobs(now)` (0031) returns the ids of
workspace deletions whose cool-off has ended (or that a crash left scheduled or running), and
`app_finalize_workspace_deletion(workspace, receipt_hash, receipt)` runs the final erase step for
the pinned workspace only.

## Exporter registry

`@causedeck/core/lifecycle` keeps a registry of `Exporter = { name, tables, collect(ctx) }`.
`collect` streams the rows of `ctx.table` page by page (500 rows, keyset order), each page in its
own `withWorkspace` transaction, so row-level security keeps every read in the requesting workspace
and memory stays bounded.

| Exporter        | Tables                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace`     | `organization`, `workspace_slug_history`                                                                                                                                                             |
| `members`       | `member` (with each member's name and email), `invitation` (no token hash)                                                                                                                           |
| `settings`      | `workspace_settings`, `workspace_feature_flag`, `matter_restriction`, `workspace_integration` (no token hash)                                                                                        |
| `audit`         | `audit_event` (through the audit read path, owners' view), `ai_call`, `support_session`                                                                                                              |
| `notifications` | `notification_pref`, `notification_setting`, `notification`                                                                                                                                          |
| `billing`       | `subscription`, `entitlement`, `billing_event` (no raw payload), `saas_invoice`, `saas_invoice_line`, `usage_counter`, `usage_event`, `usage_reservation`, `budget_override`, `usage_period_summary` |
| `blobs`         | `blob` (no envelope header or storage key) and the files themselves                                                                                                                                  |
| `lifecycle`     | `export_job` (no token hash), `deletion_job`                                                                                                                                                         |

Exclusions (`EXPORT_EXCLUSIONS`), each with its reason:

- `workspace_key`: wrapped data-encryption key. It is secret key material, not user data, and the
  files in the export are already decrypted.
- `job_effect`: internal job idempotency ledger. It holds no user content.

**Complete by construction.** `pnpm test:export-coverage` checks every tenant table in
`TABLE_TESTS` (the cross-tenant registry, itself checked against the live catalog by
`pnpm test:tenancy`). Each table must belong to exactly one exporter or have an exclusion with a
reason. A new tenant table with neither fails CI. Later milestones register exporters for their own
tables next to their domain code.

A `user` scope export keeps only the requester's rows of tables that name a user (members,
notifications, own audit events, own uploads, own exports). The other tables are empty files. It
never reads another workspace.

## Archive format

```text
README.txt                    what the archive holds, in plain words
data/<table>.jsonl            every row, one JSON object per line, for every registered table
data/<table>.csv              the same rows for the core human-readable tables (CSV_TABLES)
files/<kind>/<id>-<filename>  original files, decrypted (unsafe name characters become `_`)
manifest.json                 version, export id, workspace id, scope, row counts per table,
                              file count, exclusions, and every other entry's sha256 and size
```

CSV uses RFC 4180 quoting with the audit export's formula guard: a cell starting with `=`, `+`, `-`,
`@`, tab or CR gets a leading `'`. `verifyManifest` recomputes every listed sha256 and size, and
reports unlisted entries.

Files include every finalized, non-infected blob except previous exports. Each file is read with
`getStream` and decrypted with `decryptForWorkspace`. Plaintext objects (`enc_header` null) pass
through unchanged.

## Build (`export.build`)

`requestExport(ctx, { scope })` is for owners only. It records `export.requested` (fail-closed) and
enqueues `export.build` with ids only. A second request while one is in flight returns the running
export.

How the job builds the archive:

- The ZIP (`archiver`) streams through the workspace envelope encryption into a multipart upload
  (`storeSystemBlobStream` and `ObjectStore.putStream`: 8 MiB parts, 2 in flight). Exports use the
  server-only object kind `export`, capped at 20 GiB; upload intents refuse that kind.
- Progress and `steps` (phase `collecting`, `files`, `packaging`, `ready`) commit through the root
  client in their own `withWorkspace` transactions, at most every 2 s, so pollers see them while the
  build runs.
- The job is idempotent. A ready, failed or expired export is skipped. A retry deletes anything a
  previous attempt left (matched by `causedeck-export-<id>.zip`) and rebuilds, because a ZIP stream
  cannot resume mid-entry.
- The last retry (of 3 attempts) marks the export `failed` with a content-free `error_code`.
- When it succeeds the export becomes `ready`, with `expires_at` set to completion plus 24 h.

`system.export.expire` runs hourly at :15. It marks due exports `expired`, clears the token hash,
and deletes the object and its `blob` row. It is idempotent.

**Memory.** The 64 MB run executes on every test run and must grow RSS by less than 128 MB. The 2 GB
run requires less than 256 MB of RSS growth but only runs with `EXPORT_MEMORY_TEST=1`, because it
takes minutes on the shared build host. Both runs measure growth over the worker's RSS just before
the build, since the test runner already holds over 100 MB. Synthetic incompressible files are
generated on the fly, and the archive goes to a counting sink.

## Download

1. `POST /api/exports/[id]/download` with `{ workspaceId }`. The route checks same-origin, session
   and membership. `issueExportDownload` then checks that the user is an owner, that they requested
   this export, and that it is ready and not expired.
2. It returns a link of the form
   `base64url({ j: exportId, w: workspaceId, u: requester, exp, n }) "." HMAC-SHA256`.
   - The HMAC key is derived from `BETTER_AUTH_SECRET`.
   - `n` is a 256-bit random nonce. Only its sha256 is stored on the export, so issuing a new link
     revokes the old one.
   - `exp` is the export's expiry.
   - Issuing a link records `export.download_link_issued`.
3. `GET /api/exports/[id]/download?token=` verifies the signature and checks the token against the
   URL and the session user. Core then re-checks owner, requester, expiry and the current nonce, and
   records `export.downloaded` before the first byte.
4. The decrypted ZIP streams as an attachment (`private, no-store`, `nosniff`).

Anything wrong is a 404; only non-members and non-owners get 403.

## Privacy rules

- Export contents never reach a log line, a job payload or an audit event. Logs carry ids, counts and
  sizes only, and audit metadata holds only the scope.
- No third party receives exported data. The archive goes only to the configured object store
  (MinIO or S3 in India) and to the requesting owner.
- Download tokens are unguessable (256-bit nonce, HMAC-signed), bound to one export, one requester
  and one workspace, and expire with the export.

# Workspace deletion (#302)

```text
pending_cooloff --(14 days, system.deletion.tick)--> scheduled --(deletion.erase)--> running --> erased
       |                                                 |                              |
       +--(any owner: cancelWorkspaceDeletion)--> cancelled                             +--(last retry)--> failed
```

| State             | Meaning                                                                   | Who moves it                                         |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `pending_cooloff` | Requested; nothing erased. Members see the banner (#305).                  | Any owner cancels; the tick schedules it at the end |
| `scheduled`       | Cool-off over; `deletion.erase` enqueued. Still cancellable.               | Any owner cancels; the erase job starts it          |
| `running`         | Erasing; no longer cancellable.                                           | The erase job (resumes after a crash)               |
| `erased`          | Never stored: the final step deletes the job row with the workspace; the tombstone is the record. | -                         |
| `cancelled`       | An owner cancelled during the cool-off. Nothing was erased.               | -                                                    |
| `failed`          | The last erase retry failed; `steps.failure` holds an error code only.    | The runbook re-enqueues it; it resumes              |

## Request and cool-off

`requestWorkspaceDeletion(ctx, { confirmName }, { enqueueDelivery })` is for owners only and needs
the workspace's exact name (surrounding spaces ignored). It creates the job with
`cooloff_until = erase_after = now + 14 days`, records `workspace.deletion_requested` (fail-closed)
and notifies every active owner (`security.alert`, mandatory, in-app and email). A second request
returns the pending job. `cancelWorkspaceDeletion(ctx, jobId, deps)` works for any owner while the
job is pending or scheduled, records `workspace.deletion_cancelled` and notifies the owners.
`getActiveWorkspaceDeletion(ctx)` returns the deletion in progress to active members only. Step-up
authentication (#304) wraps these calls; the UI comes with #305.

`system.deletion.tick` runs hourly at :45. Nothing is erased before `cooloff_until`: the erase
itself also refuses (`too_early`) until then.

## Erase (`deletion.erase`)

Steps run in this order. Each one checkpoints `{ startedAt, doneAt, ...counts }` in
`deletion_job.steps` in its own transaction, so a crash or retry resumes after the last finished
step (mid-table in step 4) and no step runs twice. Up to 6 attempts with exponential backoff.

1. **Revoke access.** Set `organization.deleted_at` (the workspace disappears from every
   membership query), delete sessions whose active workspace it is, delete the workspace's
   integration tokens (`workspace_integration`: the email intake address and ICS feed, so they
   stop resolving at once), cancel pending invitations and end support sessions.
2. **Destroy the DEK.** `destroyWorkspaceKey` zeroes the wrapped key: every stored object and
   field is now unreadable, the KEK notwithstanding (`KEY_DESTROYED`).
3. **Delete blobs.** List and delete every object under `ws/<workspace id>/`.
4. **Purge rows.** Copy tax invoices to `legal_hold_invoice` (below), then delete the rows of every
   table in `PURGE_ORDER`, 500 per transaction, children before parents, plus the workspace's
   `api_idempotency_key` rows. `pnpm --filter @causedeck/core exec vitest run
   src/lifecycle/__tests__/purge-coverage.test.ts` fails when a tenant table is in neither
   `PURGE_ORDER` nor `FINALIZE_TABLES`, the same way export coverage works.
5. **Receipt and tombstone.** Read the workspace audit chain head, build and sign the receipt, and
   email it to the requesting owner. Then `app_finalize_workspace_deletion` writes the
   `deletion_tombstone`, purges `audit_event`, `ai_call` and `usage_period_summary` (which the app
   role may not delete) and deletes the organization row, cascading `deletion_job` and the
   destroyed `workspace_key`, all in one transaction. Afterwards a row count for the workspace id
   across every tenant table is zero, and decryption still answers `KEY_DESTROYED` (the storage
   layer reads the tombstone once the key row is gone).

## Receipt

```json
{
  "v": 1,
  "workspaceIdHash": "sha256(label:workspace:<id>)",
  "jobIdHash": "sha256(label:job:<id>)",
  "requestedAt": "...", "cooloffUntil": "...",
  "steps": { "revoke": { "startedAt": "...", "doneAt": "..." }, "dek": {}, "blobs": {}, "rows": {}, "receipt": { "startedAt": "..." } },
  "auditChainHead": "<hex hash of the last workspace audit event before the purge>",
  "counts": { "blobs": 0, "rows": 0, "legalHoldInvoices": 0 },
  "signature": "base64url HMAC-SHA256 over the canonical JSON of the rest"
}
```

The signature key is derived from `BETTER_AUTH_SECRET` with the label
`causedeck:deletion-receipt:v1`. `receipt_hash` is the sha256 of the canonical JSON of the whole
receipt. It holds no content: no names, slugs, emails or rows. The requester gets it by email (the
mandatory `security-alert` template) before the final step; a suppressed or rejected address is
recorded in `steps.receipt.emailSkipped` and the erase continues, since the tombstone keeps it.

## SLAs

| Target                                 | Value                                   | How                                                                                                        |
| -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Cooling-off                            | 14 days                                 | `DELETION_COOLOFF_MS`                                                                                      |
| Erase after the cool-off ends          | within 24 h                             | Hourly tick, erase job with retries (tested on a fake clock)                                               |
| Request to crypto-erase, hard SLA      | at most 30 days, cool-off included      | 14 days plus 24 h leaves 15 days of margin for incidents; the runbook covers failed jobs                  |
| Backups                                | expire on the infra retention schedule  | Out of scope here (Production Infra); documented in the runbook                                            |

## Retention

What survives a workspace deletion:

- `deletion_tombstone`: the workspace id, the time and the signed receipt.
- `legal_hold_invoice`: **legal-hold rule** (`LEGAL_HOLD_RULE`). Issued, paid and void SaaS
  invoices (drafts were never tax invoices) are excluded from erasure and kept in minimal form,
  `legal_hold = true`, until 31 March of the eighth year after their financial year ends. Kept:
  number, series, financial year, status, dates, place of supply, SAC, the amounts, currency, and
  the supplier's and recipient's GSTIN and state code. Dropped: legal names, addresses, line
  descriptions, payment ids and the PDF. The exact statutory field list awaits counsel/CA
  confirmation (#31).
- Platform staff audit (account chain) is not workspace data and is kept.

Everything else, including the workspace's own audit chain, is erased.

## DPDP mapping

| DPDP Act 2023 / Rules                                   | Mechanism                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Right to erasure (s. 12)                                | Owner-requested workspace deletion; account deletion with #303                                          |
| Erase when the purpose is served (s. 8(7))              | Crypto-erase (DEK destroyed) plus purge of every tenant row and object; purge-coverage test              |
| Retention required by other law (s. 8(7) proviso)       | Legal-hold rule for tax invoices, minimal form, fixed retention                                         |
| Security safeguards (s. 8(5))                           | Envelope encryption; key destruction makes backups and stray copies unreadable                           |
| Proof and accountability                                | Signed, content-free receipt on the tombstone, emailed to the requester; audit events until the final step |
| Right to access (s. 11)                                 | Workspace export (above), recommended before deletion (#305)                                            |
