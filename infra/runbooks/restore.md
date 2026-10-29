# Backup and restore runbook (#101)

Owner: Engineering lead
Last drilled: not yet drilled (record: [drills](drills/README.md))

## Purpose

Stage A: WAL-G on the single India VPS archives to the stack's MinIO bucket `causedeck-wal`;
`minio-replicate` copies it nightly (WAL continuously) to AWS S3 `ap-south-2` (Hyderabad), see
[dr-hyderabad](dr-hyderabad.md) for the replica, its encryption and the bucket lifecycle (30 days for WAL and base
backups, 180 days for logs). Targets (PRD §8): RPO ≤ 15 min,
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
| Replication (to S3 ap-south-2) | `... run --rm minio-replicate`                                           | 02:00 daily          |
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

## Alert thresholds (wired by #102)

`system.backup.health` exposes `walg_last_archive_age_seconds`, `walg_last_backup_age_seconds`,
`restore_drill_last_success_timestamp`, `restore_drill_rto_seconds` and logs an error with
`backup_alert=true` per breach. Page within 10 minutes on: archive age > 300 s, base backup older
than 26 h or failed, replication failed, last drill failed, RPO > 900 s, RTO > 14 400 s, no
successful drill in 8 days.

## Steps

Point-in-time restore:

1. Declare an incident; stop writes (`docker compose stop web api worker admin`).
2. Provide `WALG_LIBSODIUM_KEY_PATH` (key from custody), `WALG_S3_PREFIX`, `AWS_ENDPOINT` and the
   read-only restore credentials as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. To restore from the Hyderabad
   replica use `WALG_S3_PREFIX=s3://<REPLICA_BUCKET>/causedeck-wal`, `AWS_ENDPOINT=https://s3.ap-south-2.amazonaws.com`,
   `AWS_REGION=ap-south-2`.
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
