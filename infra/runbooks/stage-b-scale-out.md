# Stage B scale-out runbook (#106)

Stage B moves Postgres to RDS (ap-south-1, replica in ap-south-2), documents from MinIO to S3, and
puts an ALB in front of two or more app nodes. This runbook is the plan; it does not perform the
migration. Terraform lives in `infra/terraform/envs/stage-b` and is only validated and planned in
CI (`terraform.yml` has no apply or drift path for it). **Apply is manual and gated, never automatic:**
at cutover a reviewed PR adds `stage-b` to the `workflow_dispatch` apply options, which run in a
GitHub environment `terraform-stage-b` with required reviewers, like staging and prod (#99, #116).

Scripts: `infra/scripts/stage-b/migrate-postgres-to-rds.sh`, `infra/scripts/stage-b/migrate-minio-to-s3.sh`
(both dry-run by default, India guards, `--execute` to act). Verification ideas follow
`infra/scripts/restore/verify.sql`; Stage A recovery is `restore.md` and `dr-hyderabad.md`.

## Triggers

Start Stage B when any one holds for two consecutive weeks (or once, if it is an incident):

| Trigger       | Measure                                                     |
| ------------- | ----------------------------------------------------------- |
| Latency       | p95 of API and web requests above 400 ms in working hours   |
| Database load | Postgres CPU above 60% sustained over the court-day windows |
| Seats         | more than 1,000 active seats                                |

## Freeze windows

No cutover step runs between **18:00 and 23:00 IST** or between **07:00 and 10:30 IST** (court-day
and filing windows). The timeline below sits entirely between 23:30 and 06:30 IST, on a night with
no known filing deadline. If a step slips past 06:30, roll back; do not run into 07:00.

## Pre-checks (T-7 days to T-1 day)

1. A Stage B plan is clean: `terraform plan` in `envs/stage-b` (CI plan on the PR is green) and the
   gated apply for the data layer has run and been reviewed by the second approver.
2. The last Stage A restore drill passed within 7 days (`restore.md`); a fresh base backup exists.
3. The rehearsals below are recorded as passed (post-deploy; see "Rehearsal results").
4. RDS and S3 are in India regions only (`terraform output`), RDS is `publicly_accessible = false`,
   the app security groups reach it, and `sslmode=verify-full` works from both nodes.
5. `pnpm scale-readiness` passes on the release being deployed (stateless containers, env-only config).
6. The second node is provisioned, the ALB target group is healthy on `/readyz` with the Stage A node.
7. DNS TTL for `app.` and `api.` is lowered to 60 s at T-1 day.
8. The communication to customers has gone out (templates below).

## Cutover timeline (IST, one night)

Each step lists its rollback. Stop and roll back at the first failed check.

| Time  | Step                                                                                                                                                                                  | Rollback                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 23:30 | Go/no-go: pre-checks green, on-call and second person present, status page set to maintenance notice.                                                                                 | Cancel; nothing changed.                                                                             |
| 23:45 | Fresh base backup of Stage A Postgres; record the backup name.                                                                                                                        | None needed.                                                                                         |
| 00:00 | `migrate-postgres-to-rds.sh --execute setup`: schema, publication, subscription.                                                                                                      | `--execute rollback`: drops the subscription; Stage A stays authoritative.                           |
| 00:15 | Wait for the initial copy; `--execute verify` (row counts and RLS state match).                                                                                                       | `--execute rollback`.                                                                                |
| 01:00 | `migrate-minio-to-s3.sh --execute` (first pass), then `--verify` (rclone check, checksums).                                                                                           | Delete nothing on MinIO; point `S3_*` back to MinIO (env only).                                      |
| 02:00 | Start of the write freeze: `migrate-postgres-to-rds.sh --execute cutover` (source read-only, catch-up, verify). Note the start time.                                                  | `--execute rollback` reopens the source for writes.                                                  |
| 02:10 | Final `migrate-minio-to-s3.sh --execute` for the delta, then `--verify`.                                                                                                              | Same as 01:00.                                                                                       |
| 02:20 | Deploy env change on both nodes: `DATABASE_URL` (RDS, `sslmode=verify-full`), `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION=ap-south-1`, no `S3_ENDPOINT`. Restart web, api, worker. | Restore the previous env file and restart; the source is still current only if no write reached RDS. |
| 02:40 | Smoke: login, open a matter, upload and download a document, a worker job runs, `/readyz` is 200 on both nodes. Record the downtime (cutover note to now).                            | Before the first write on RDS: roll back as above. After: see below.                                 |
| 03:00 | Add `app.` and `api.` DNS-only records to the ALB (`terraform output alb_dns_name`); remove the old A records after 24 h.                                                             | Re-point the records at the Stage A node.                                                            |
| 03:30 | Lift the notice; keep Stage A Postgres and MinIO read-only and untouched for 7 days.                                                                                                  | n/a                                                                                                  |
| 06:30 | Hard stop. If any step is unfinished, roll back now.                                                                                                                                  | As per step.                                                                                         |

After the first write on RDS, a rollback needs reverse replication or a restore from RDS PITR; treat
it as an incident (`on-call.md`) rather than a rollback.

## Communication templates

Before (T-3 days, email and in-app): "On <date> between 00:00 and 05:00 IST CauseDeck will be briefly
read-only (about 15 minutes) while we move to new India infrastructure. Court-day features and
cause lists are unaffected during working hours. No action is needed."

During (status page): "Maintenance in progress: CauseDeck is read-only until about <time> IST.
Data stays in India."

After: "The move is complete. If anything looks wrong, reply to this message or use WhatsApp support."

Rollback notice: "We paused the move and CauseDeck is back to normal. We will reschedule."

## Rehearsals (before the cutover)

Both run against staging data and scratch targets; they are separate from production.

1. Postgres: logical replication from the staging compose Postgres to a scratch Postgres
   (`ALLOW_LOCAL_TARGET=1`) or a scratch RDS: `setup`, `verify`, `cutover`. Pass when row counts and RLS
   state match and the downtime is recorded.
2. MinIO to S3: seeded documents, `migrate-minio-to-s3.sh --execute` into a scratch bucket, then
   `--verify`. Pass when `rclone check` reports no differences.
3. Restore from RDS PITR once, with `infra/scripts/restore/verify.sql` ideas.

### Rehearsal results (filled after deploy)

| Rehearsal                    | Date | Operator | Rows or objects checked | Downtime or duration | Result |
| ---------------------------- | ---- | -------- | ----------------------- | -------------------- | ------ |
| Postgres logical replication |      |          |                         |                      |        |
| MinIO to S3 sync             |      |          |                         |                      |        |

## KMS move (envelope encryption)

The workspace DEKs are wrapped by a KEK. At Stage A the KEK is `KEK_BASE64` from env and the secret
manager (`EnvKeyProvider`). At Stage B the KEK moves to KMS in ap-south-1 (`KmsKeyProvider`, see
[storage.md](../../docs/engineering/storage.md)):

1. Deploy a provider that holds the KMS key (current) and `kek-1` (old); new DEKs are wrapped by KMS.
2. Run `rewrapAll(db, provider, <kms kek id>)`; it unwraps each DEK with the old KEK and stores it
   re-wrapped by KMS, one workspace per transaction. Objects and fields do not change and reads work
   throughout.
3. When `pendingRewrap` is empty, retire `KEK_BASE64` from the provider and the secret store.

The sequence is the one in the KEK rotation section of storage.md. Backups keep their own WAL-G key
(`restore.md`, key custody). Do this after the data cutover, not in the same night.

## Apply

Terraform for Stage B is applied only through the manual, gated workflow described at the top, with
reviewers. A plan in CI uses dummy credentials and never changes infrastructure. `enable_cloudflare_lb` stays `false` unless D-037 is
recorded and `approval_doc` exists; the ALB is the default entry.
