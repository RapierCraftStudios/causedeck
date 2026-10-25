# DR: losing the VPS (#101)

Owner: Engineering lead
Last drilled: not yet drilled (record: [drills](drills/README.md))

## Purpose

Scenario: the production VPS (India, Hyderabad region) is gone. Data lives in WAL-G backups on the
second India location (nightly MinIO replica) and, if still reachable, the primary MinIO.

Expected duration: about 3 hours (target RTO 4 h, RPO 15 min). Measured values come from the drill records in
[drills](drills/README.md) and the weekly restore drill report; none is signed yet, so the targets apply. Rehearse
before launch.

## Triggers

The VPS is unreachable or destroyed and cannot be recovered in place. Also opens [cert-in-6h](cert-in-6h.md) when
caused by an attack, and [restore](restore.md) for the restore mechanics.

## Roles

Incident commander, engineering lead (approves DNS switch), second custodian (WAL-G key, [key-rotation](key-rotation.md)).

## Steps

1. **Decide and announce** (5 min). Declare the incident; post the status page notice.
2. **Provision** (30 to 45 min). Terraform apply for a new VPS in an India region (#108), then
   `infra/scripts/bootstrap-vps.sh`. Never provision outside India.
3. **Secrets** (15 min). Restore the stack env file and the WAL-G key from custody (see
   `restore.md`) onto tmpfs; set `WALG_S3_PREFIX` and `AWS_ENDPOINT` to the surviving India copy,
   with read-only restore credentials.
4. **Restore** (60 to 90 min). `restore-prod.sh --i-understand --target-volume <new>` with
   `--target-time latest`; wait for WAL replay; run `verify.sql`.
5. **Start the stack** on the restored volume (`docker compose up -d`), run the migrations job,
   check `/healthz`.
6. **DNS** (10 min plus TTL). Point the A/AAAA records at the new VPS; keep TTL at 300 s.
7. **Re-erase**: run `system.deletion.tick` so workspaces deleted since the backup stay deleted.
8. **Re-establish backups**: take a base backup, re-enable the timers, point replication at a new
   second location; confirm `system.backup.health` is green.
9. **Close**: write the post-mortem, record measured RTO/RPO in `drills/`.

## Communications

Status page notice at step 1 and on recovery; customer notices only after human approval and sent by a human. No
automated outbound messages go to courts or third parties.

## Evidence

Timeline in the ticket, `verify.sql` output, the Terraform run, DNS change record.

## Verification

`verify.sql` passes, `/healthz` is green, `system.backup.health` is green, DNS resolves to the new VPS.

## After action

[Post-incident review](templates/post-incident-review.md); drill record in [drills](drills/README.md); update `Last drilled`.

Status: not yet rehearsed. The rehearsal needs the real VPS (#108) and storage credentials (#116).
