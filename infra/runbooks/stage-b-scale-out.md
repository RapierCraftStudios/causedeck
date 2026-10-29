# Stage B and C scale-out runbook (#106, #887)

Owner: Engineering lead

Stage B splits state off the Stage A VPS. **The default path is rented servers in OVH Mumbai** (D-037
amendment, [ADR 0053](../../docs/adr/0053-stage-b-c-scale-path.md)): Postgres on its own VPS with a
streaming replica and PgBouncer, two or more app VPS reached by DNS-only records, MinIO and its
documents staying on the Mumbai hosts, backups to the Hyderabad bucket. The AWS path (RDS, S3, ALB) is
an optional alternative, kept at the end of this runbook. This runbook is the plan; it does not
perform the migration.

Terraform lives in `infra/terraform/envs/stage-b-ovh` (rented path) and `envs/stage-b` (AWS path).
CI validates both and tests the OVH root with a mocked provider; neither is planned against a real
account or applied by CI (`terraform.yml` has no apply or drift path for them). **Ordering servers
spends money, so apply is manual and gated, never automatic:** at cutover a reviewed PR adds the root
to the `workflow_dispatch` apply options, which run in a GitHub environment with required reviewers,
like staging and prod (#99, #116); the first order may instead be run by the founder from a laptop with
the OVH credentials in the environment (see `infra/terraform/README.md`, "OVH API credentials").

Scripts: `infra/scripts/stage-b/migrate-compose-to-dedicated-postgres.sh` (default),
`migrate-postgres-to-rds.sh` and `migrate-minio-to-s3.sh` (AWS path); all dry-run by default, with
residency guards and `--execute` to act. Database compose: `infra/docker/compose.db.yml`, env
`infra/docker/env/db.env.example`. Verification ideas follow `infra/scripts/restore/verify.sql`; Stage A
recovery is `restore.md` and `dr-hyderabad.md`.

## Triggers

Start a stage when any one of its triggers holds for two consecutive weeks (or once, if it is an
incident). Triggers come from the spike, section 3.2.

| Stage | Trigger        | Measure                                                                                         |
| ----- | -------------- | ----------------------------------------------------------------------------------------------- |
| B     | Latency        | p95 of API and web requests above 400 ms in working hours                                       |
| B     | Database load  | Postgres CPU above 60% sustained over the court-day windows                                     |
| B     | Seats          | more than 1,000 active seats                                                                    |
| C     | Seats or teams | more than 10,000 seats or several teams (per-technology triggers in `stage-c-orchestration.md`) |

## Cost per stage

Monthly, 12-month term, ex-GST, INR. Source: the OVH public catalogue for the Ireland subsidiary
(`GET /order/catalog/public/vps?ovhSubsidiary=IE`, EUR ex-VAT, pricing mode `upfront12`), **fetched
2026-10-29**, converted at about 111 INR per EUR, the rate implied by the D-037 amendment's own India
prices (VPS-3 ₹1,160, VPS-1 ₹420, 2026-10-27). The India catalogue is not reachable by API, so treat
these as estimates and confirm the figures when the servers are ordered (#108). Each VPS carries the
mandatory 1-day automated backup option (VPS-1 about ₹39, VPS-3 about ₹67, VPS-4 about ₹111).

| Item                                  | Plan                  | Each, with backup option | Stage A     | Stage B (default)           | Stage C (3 app + 1 worker node) |
| ------------------------------------- | --------------------- | ------------------------ | ----------- | --------------------------- | ------------------------------- |
| Prod app (and everything on one host) | VPS-3 (6 vCPU, 12 GB) | ~₹1,225                  | 1           | 2                           | 3                               |
| Postgres primary                      | VPS-4 (8 vCPU, 24 GB) | ~₹2,330                  | on VPS-3    | 1                           | 1                               |
| Postgres replica                      | VPS-4                 | ~₹2,330                  | none        | 1                           | 1                               |
| Worker node                           | VPS-3                 | ~₹1,225                  | none        | none (workers on app nodes) | 1                               |
| Staging                               | VPS-1 (2 vCPU, 4 GB)  | ~₹460                    | 1           | 1                           | 1                               |
| **Monthly total**                     |                       |                          | **~₹1,700** | **~₹7,600**                 | **~₹10,000**                    |

Not included: object storage and egress for the Hyderabad backup bucket, domain, email. A dedicated
server for Postgres (when VPS-4 is outgrown) is priced at order time. For comparison the AWS path in
`stage-c-orchestration.md` ("Cost model") costs several times more per 1,000 seats.

## Freeze windows (both paths)

No cutover step runs between **18:00 and 23:00 IST** or between **07:00 and 10:30 IST** (court-day
and filing windows). The timeline below sits entirely between 23:30 and 06:30 IST, on a night with
no known filing deadline. If a step slips past 06:30, roll back; do not run into 07:00.

## Pre-checks (T-7 days to T-1 day)

1. Terraform: `terraform test` is green for `envs/stage-b-ovh` in CI; `terraform output` after the
   gated apply lists `db_primary_ipv4`, `db_replica_ipv4`, `app_ipv4s` and `node_datacenters`, and every
   node is `YNM`. Each node ran `infra/scripts/bootstrap-vps.sh` (ufw, deploy key, key-only SSH).
2. Firewalls: on the primary, 5432 and 6432 are open to the replica and the app nodes only; on the
   replica, 6432 to the app nodes only (`ufw allow from <ip> to any port 5432 proto tcp`). Nothing else
   listens publicly.
3. The last Stage A restore drill passed within 7 days (`restore.md`); a fresh base backup exists.
4. The source (Stage A Postgres) has `wal_level = logical`: `ALTER SYSTEM SET wal_level = logical;`
   then one restart in a quiet window **before** the cutover night. The source's 5432 is reachable from
   the new primary (a temporary `ufw` rule for the primary's IP, removed after promote), and
   `SUBSCRIPTION_SOURCE_URL` is set accordingly.
5. The database tier is up: `docker compose -f compose.db.yml --env-file /etc/causedeck/db.env
--profile primary up -d --wait` on the primary node (WAL-G key in place, first archive visible in
   the Hyderabad bucket), then `--profile replica` on the replica node. On the primary,
   `select client_addr, state, sync_state from pg_stat_replication` shows the replica `streaming`; on the
   replica, `select pg_is_in_recovery()` is `t` and an INSERT fails (read-only).
6. PgBouncer TLS: `server.crt` and `server.key` exist under `PGBOUNCER_TLS_DIR` on both database nodes
   (`openssl req -x509 -nodes -newkey rsa:3072 -days 825 -subj "/CN=db" -keyout server.key -out
server.crt`, key 0640), and `psql "postgres://causedeck_app@<node>:6432/causedeck?sslmode=require"` works
   from an app node.
7. The target schema is loaded as the owner role through the primary directly (not PgBouncer):
   `DATABASE_URL_OWNER=postgres://causedeck_owner:...@<primary>:5432/causedeck?sslmode=require pnpm db:migrate`.
8. The app nodes run `compose.prod.yml` at the same `GIT_SHA`; `/readyz` is 200 on each.
9. `pnpm scale-readiness` passes on the release being deployed (stateless containers, env-only config).
10. DNS TTL for `app.` and `api.` is lowered to 60 s at T-1 day.
11. The communication to customers has gone out (templates below).

## Cutover timeline (IST, one night)

Each step lists its rollback. Stop and roll back at the first failed check. `export SOURCE_URL=...
TARGET_URL=...?sslmode=require TARGET_ALLOWED_HOSTS=<primary host>` first.

| Time  | Step                                                                                                                                                                                                                            | Rollback                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 23:30 | Go/no-go: pre-checks green, on-call and second person present, status page set to maintenance notice.                                                                                                                           | Cancel; nothing changed.                                                                                   |
| 23:45 | Fresh base backup of Stage A Postgres; record the backup name.                                                                                                                                                                  | None needed.                                                                                               |
| 00:00 | `migrate-compose-to-dedicated-postgres.sh --execute setup`: publication on the source, subscription on the new primary.                                                                                                         | `--execute rollback`: drops the subscription; Stage A stays authoritative.                                 |
| 00:15 | Wait for the initial copy; `--execute verify` (row counts and RLS state match).                                                                                                                                                 | `--execute rollback`.                                                                                      |
| 02:00 | Start of the write freeze: `--execute cutover` (source read-only, catch-up, verify). Note the start time.                                                                                                                       | `--execute rollback` reopens the source for writes.                                                        |
| 02:10 | `--execute promote`: copies the sequences, drops the subscription; the new primary is independent. The replica streams from it.                                                                                                 | Before the first write on the new primary: `--execute rollback` (reopens the source).                      |
| 02:20 | Deploy env change on every app node: `DATABASE_URL` to the primary's PgBouncer (`postgres://causedeck_app:...@<primary>:6432/causedeck?sslmode=require`), `DATABASE_URL_OWNER` to the primary's 5432, restart web, api, worker. | Restore the previous env file and restart; the source is current only if no write reached the new primary. |
| 02:40 | Smoke: login, open a matter, upload and download a document, a worker job runs, `/readyz` is 200 on every node. Record the downtime (cutover note to now).                                                                      | Before the first write on the new primary: roll back as above. After: see below.                           |
| 03:00 | Add `app.` and `api.` DNS-only A records for every app node (`terraform output app_ipv4s`); remove the old record after 24 h. Close the temporary source firewall rule.                                                         | Re-point the records at the Stage A node.                                                                  |
| 03:30 | Lift the notice; keep Stage A Postgres read-only and untouched for 7 days.                                                                                                                                                      | n/a                                                                                                        |
| 06:30 | Hard stop. If any step is unfinished, roll back now.                                                                                                                                                                            | As per step.                                                                                               |

Documents stay in MinIO on the Mumbai hosts at Stage B. With more than one app node MinIO must be
reachable from all of them: keep it on the primary app node (node 1) and point `S3_ENDPOINT` on the
other nodes at its address over TLS, or move documents to S3 ap-south-1 or ap-south-2 with the AWS path's
`migrate-minio-to-s3.sh` once volume justifies it.

After the first write on the new primary, a rollback needs reverse replication or a restore from the
WAL-G backup; treat it as an incident (`on-call.md`) rather than a rollback.

## Replica operations and failover

- Health: `pg_stat_replication` on the primary (`state = streaming`, `replay_lag` under 5 s) and
  `pg_stat_wal_receiver` on the replica. A replica that is down holds WAL on the primary through its
  slot: if it stays down for more than a day, drop the slot (`select pg_drop_replication_slot('replica1')`)
  and re-clone, rather than filling the disk.
- Re-clone: stop the replica, delete its volume (`docker volume rm causedeck-db_pgdata_replica`), start
  `--profile replica`; the entrypoint runs `pg_basebackup` again.
- Failover (manual, only when the primary is lost): confirm the primary is down and fenced (stop the
  container or the VPS), run `docker exec <replica> pg_ctl promote`, point `DATABASE_URL` on the app nodes
  at the replica's PgBouncer, restart the apps, then build a new replica from the promoted node and re-point
  WAL archiving (a promoted node starts a new timeline; archive from it with the same WAL-G settings).
  Expect a few minutes of downtime and no more than the last unreplicated transactions lost; record it as
  an incident.
- Reads on the replica (reporting) go through `pgbouncer-replica`; the app does not use it yet.

## Stage C (more nodes, orchestration)

Triggers are in the table above and in `stage-c-orchestration.md`. On the rented path Stage C means
more of the same boxes under k3s or Docker Swarm: add nodes with `app_node_count`, move to per-queue
worker services on a worker node, and add Redis, OpenSearch or PowerSync only when their own triggers
fire. ECS Fargate and ElastiCache (`envs/stage-b`, `enable_stage_c`) stay optional skeletons.

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
   (`ALLOW_LOCAL_TARGET=1`) or the staging database node: `setup`, `verify`, `cutover`, `promote`. Pass
   when row counts and RLS state match, a new row on the target gets a fresh id after promote, and the
   downtime is recorded. (The manual run stays post-deploy, #808.)
2. Replica: clone a replica from the staging primary, confirm `pg_is_in_recovery()`, a failed INSERT,
   and a promote on a throwaway copy.
3. Restore from the WAL-G backup once, with `infra/scripts/restore/verify.sql` ideas.

### Rehearsal results (filled after deploy)

| Rehearsal                    | Date | Operator | Rows or objects checked | Downtime or duration | Result |
| ---------------------------- | ---- | -------- | ----------------------- | -------------------- | ------ |
| Postgres logical replication |      |          |                         |                      |        |
| MinIO to S3 sync             |      |          |                         |                      |        |

## Apply

Terraform for Stage B is applied only through a manual, gated step, with reviewers. A plan in CI never
changes infrastructure; the OVH root is tested with a mocked provider, so a real `terraform plan` is the
reviewer's check before the gated apply. `enable_cloudflare_lb` stays `false` unless D-037 is recorded and
`approval_doc` exists; DNS-only records (or the ALB on the AWS path) are the entry.

## Optional AWS path (RDS, S3, ALB)

Use this only if the team chooses managed services over the rented path. Stage B moves Postgres to RDS
(ap-south-1, replica in ap-south-2), documents from MinIO to S3, and puts an ALB in front of two or more
app nodes; Terraform is `envs/stage-b` and is plan-only in CI.

### Pre-checks (T-7 days to T-1 day)

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

### Cutover timeline (IST, one night)

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

### KMS move (envelope encryption)

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
