# Backup and restore runbook (#101)

Owner: Engineering lead
Last drilled: not yet drilled (record: [drills](drills/README.md))

## Purpose

Stage A: WAL-G on the single India VPS archives to the stack's MinIO bucket `causedeck-wal`;
`minio-replicate` copies it nightly to a second India location. Targets (PRD §8): RPO ≤ 15 min,
RTO ≤ 4 h. Scripts: `infra/scripts/backup/`, `infra/scripts/restore/`.

Measured values: the weekly drill report (`.github/workflows/restore-drill.yml` artifact) and the signed records in
[drills](drills/README.md) carry the measured RPO and RTO. No signed drill exists yet, so the targets above are
the commitment; update this page from the first signed record. Loss, damage or suspected tampering of data opens
[cert-in-6h](cert-in-6h.md) and, for personal data, [dpdp-breach](dpdp-breach.md). Key handling is in
[key-rotation](key-rotation.md).

## Triggers

Data loss or corruption, a failed restore drill or backup alert (P0/P1, [on-call](on-call.md)), the monthly drill,
or a DR event ([dr-hyderabad](dr-hyderabad.md)).

## Roles

Incident commander (on-call primary) runs the restore; the engineering lead approves switching production to the
restored volume; a second custodian provides the backup key when needed.

## What runs

| What                           | How                                                                      | When (IST)           |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------- |
| WAL archive                    | `archive_command = 'wal-g wal-push %p'`, `archive_timeout = 60`          | continuous           |
| WAL freshness check            | `docker compose --profile backup run --rm backup walg-wal-push-check.sh` | every minute         |
| Base backup, verify, retention | `... run --rm backup walg-basebackup.sh`                                 | 01:00 daily          |
| Replication                    | `... run --rm minio-replicate`                                           | 02:00 daily          |
| Health job                     | `system.backup.health` (worker) reads status JSON from `causedeck-ops`   | every minute         |
| Restore drill                  | `.github/workflows/restore-drill.yml` against staging                    | weekly, Monday 03:00 |
| Human drill                    | this runbook, signed off in `drills/`                                    | monthly              |

Retention is configurable: `BACKUP_RETAIN_DAILY=14` full backups with their WAL (14 days of PITR)
and `BACKUP_RETAIN_WEEKLY=8` weekly backups (the Sunday backup is marked permanent with
`wal-g backup-mark`, unmarked after 8 weeks). Each base backup is verified with
`wal-g backup-list`; a missing backup fails the run.

## Encryption and key custody

Backups are encrypted client-side with WAL-G libsodium. Without the key, `wal-push`,
`backup-fetch` and `wal-fetch` fail, so a stolen bucket is unreadable.

- The key is a 32-byte hex file. It is never in an env file, an image or the data volume.
- On the host it exists only on tmpfs (`/run/causedeck/walg.key`, 0440), written at boot from
  sealed custody; compose passes it to `postgres` and `backup` as a secret (`WALG_KEY_FILE`).
- Custody copies live off host: two sealed copies held by two named people (password manager
  vault plus an offline printout in a safe). Losing every copy makes every backup unrecoverable.
- Rotation: generate a new key, deploy it, take a new base backup, keep the old key until the last
  backup made with it has aged out (14 days plus the 8 weekly backups, so 8 weeks), then destroy it.
- Access: archiver credentials are write-only, `backup` (maintenance) lists, puts and deletes,
  restore uses separate read-only credentials. Buckets are never public; access logging is the
  audit stack (#102).

## Alert thresholds (wired in #102, R9 in #792)

`system.backup.health` runs every minute and exports gauges through the OTel collector, and logs an error with
`backup_alert=true` per breach. The rules live in `infra/monitoring/prometheus/rules/alerts.yml` (group `backups`),
each with a promtool case in `infra/monitoring/prometheus/tests/alerts.test.yml`. Every rule pages (P0 or P1, so
on-call and the fallback receiver) with `for` of 1 to 2 minutes; the detection budget is about 4.5 minutes after the
signal exists (job 60 s, OTLP export 60 s, scrape 30 s, evaluation 30 s, `for` 1 m, group_wait 10 s), inside the 10
minute target.

| Alert                      | Fires when                                                                             | Priority |
| -------------------------- | -------------------------------------------------------------------------------------- | -------- |
| `BackupWalStale`           | `walg_last_archive_age_seconds` > 300 (or report missing, -1)                          | P0       |
| `BackupFailed`             | `walg_backup_last_ok` is 0 (last base backup run failed)                               | P0       |
| `BackupBaseStale`          | `walg_last_backup_age_seconds` > 26 h (or missing)                                     | P1       |
| `BackupReplicationFailed`  | `minio_replication_last_ok` is 0                                                       | P1       |
| `RestoreDrillFailed`       | `restore_drill_last_ok` is 0                                                           | P1       |
| `RestoreDrillTargetBreach` | `restore_drill_rpo_seconds` > 900 or `restore_drill_rto_seconds` > 14 400              | P1       |
| `RestoreDrillStale`        | no successful drill for 8 days (`restore_drill_last_success_timestamp`)                | P1       |
| `BackupHealthJobSilent`    | `backup_health_last_run_timestamp` older than 5 min or absent: backups are unmonitored | P1       |

`BackupHealthJobSilent` also fires when `BACKUP_OPS_*` is not set on the worker (the job then exports nothing).

## Steps

Point-in-time restore:

1. Declare an incident; stop writes (`docker compose stop web api worker admin`).
2. Provide `WALG_LIBSODIUM_KEY_PATH` (key from custody), `WALG_S3_PREFIX`, `AWS_ENDPOINT` and the
   read-only restore credentials as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
3. Pick the target: `latest`, or a UTC time just before the damage.
4. Run `RESTORE_IMAGE=<postgres image> bash infra/scripts/restore/restore-prod.sh --i-understand
--target-volume restore_<date> --target-time <UTC>`. It refuses without `--i-understand`, onto
   an existing non-empty volume, onto the production volume, or against a non-India target.
5. Start a Postgres container on the new volume, wait for recovery to finish.
6. Verify: run `infra/scripts/restore/verify.sql` (amcheck, row counts, RLS, cross-tenant,
   crypto-erase), then switch the stack's `pgdata` to the new volume and start the apps. Keep the
   old volume until the incident closes.

## Communications

Post a status page notice when writes stop and when service resumes. No automated outbound messages go to courts or
third parties; notices are approved by a human and sent by a human after approval.

## Evidence

Keep the drill JSON report (`rtoSeconds`, `rpoSeconds`, `checks`, `ok`), the `verify.sql` output and the incident
ticket with times.

## Verification

`verify.sql` passes (amcheck, row counts, RLS, cross-tenant, crypto-erase); the app health check is green on the
restored volume; measured RPO ≤ 900 s and RTO ≤ 14 400 s.

## Drills

The drill (`restore-drill.sh`) restores the latest backup plus WAL to a timestamp in a throwaway
container on a fresh volume, runs `verify.sql`, writes a JSON report (`rtoSeconds`, `rpoSeconds`,
`checks`, `ok`) and publishes it for the health job. Monthly: a human runs it against production
backups, reads the report, and files a sign-off in `infra/runbooks/drills/`.

## Crypto-erase interplay

Deleting a workspace zeroes its DEK before purge (`workspace-deletion.md`). A backup taken before
that holds the wrapped DEK until it ages out (at most 14 days daily, 8 weeks weekly). Rules:

- Never restore a deleted workspace from a backup; after any restore, re-run the deletion job
  (`system.deletion.tick`) so erased workspaces are erased again.
- The `crypto_erase` check in `verify.sql` fails the drill if a destroyed workspace key in the
  restored database still holds key material.
- Once the key-backup retention window (8 weeks) has passed, no backup holds the DEK.

## After action

Post-incident review ([template](templates/post-incident-review.md)); record the measured RPO and RTO in
[drills](drills/README.md) and update this runbook and `Last drilled`.
