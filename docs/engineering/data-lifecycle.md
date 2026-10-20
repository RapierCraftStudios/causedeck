# Data lifecycle: workspace export

DPDP data lifecycle (#31, PRD PL-8). This page covers part 1, workspace export (#301): the lifecycle
tables, the exporter registry, the streaming ZIP and its download. Workspace deletion (#302), account
and memory erasure (#303), step-up authentication (#304) and the UI (#305) extend it.

```sh
pnpm --filter @causedeck/core exec vitest run src/lifecycle      # export, coverage, cross-tenant, privacy, memory (64 MB)
pnpm test:export-coverage                                         # completeness gate (CI: tenancy job)
EXPORT_MEMORY_TEST=1 pnpm --filter @causedeck/core exec vitest run src/lifecycle/__tests__/export.memory.test.ts  # 2 GB run
pnpm --filter @causedeck/storage exec vitest run src/__tests__/stream.test.ts
pnpm --filter @causedeck/web exec vitest run app/api/exports
```

## Tables (`0025_lifecycle`)

| Table                | Scope                                                      | Notes                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export_job`         | tenant, FORCE RLS                                          | `scope` `workspace` or `user`; `status` `queued`, `running`, `ready`, `failed`, `expired`; `progress` 0 to 100; `steps` checkpoints; `blob_id`, `size_bytes`, `sha256` of the plaintext ZIP; `download_token_hash`; `expires_at`. One queued or running export per requester and workspace. |
| `deletion_job`       | tenant, FORCE RLS, `workspace_id` null for account deletion | Schema only; behaviour in #302 and #303.                                                                                                                                          |
| `deletion_tombstone` | global (`GLOBAL_TABLES`)                                   | Minimal record of an erased workspace. No foreign key, so it outlives the purge; the app and clerk roles cannot update or delete it.                                           |

`app_export_due_jobs(now)` is an owner-defined function returning only the ids of ready exports past
their expiry, for the system expiry job.

## Exporter registry

`@causedeck/core/lifecycle` keeps a registry of `Exporter = { name, tables, collect(ctx) }`.
`collect` streams the rows of `ctx.table` page by page (500 rows, keyset order), each page in its
own `withWorkspace` transaction, so row-level security keeps every read in the requesting workspace
and memory stays bounded.

| Exporter        | Tables                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace`     | `organization`, `workspace_slug_history`                                                                                                                         |
| `members`       | `member` (with each member's name and email), `invitation` (no token hash)                                                                                       |
| `settings`      | `workspace_settings`, `workspace_feature_flag`, `matter_restriction`                                                                                             |
| `audit`         | `audit_event` (through the audit read path, owners' view), `ai_call`, `support_session`                                                                          |
| `notifications` | `notification_pref`, `notification_setting`, `notification`                                                                                                      |
| `billing`       | `subscription`, `entitlement`, `billing_event` (no raw payload), `saas_invoice`, `saas_invoice_line`, `usage_counter`, `usage_event`, `usage_reservation`, `budget_override`, `usage_period_summary` |
| `blobs`         | `blob` (no envelope header or storage key) and the files themselves                                                                                             |
| `lifecycle`     | `export_job` (no token hash), `deletion_job`                                                                                                                    |

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
