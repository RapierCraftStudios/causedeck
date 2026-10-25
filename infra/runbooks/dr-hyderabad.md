# DR: losing the VPS (#101)

Scenario: the production VPS (India, Hyderabad region) is gone. Data lives in WAL-G backups on the
second India location (nightly MinIO replica) and, if still reachable, the primary MinIO.

Expected duration: about 3 hours (target RTO 4 h). Rehearse before launch and record it in
`infra/runbooks/drills/`.

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

Status: not yet rehearsed. The rehearsal needs the real VPS (#108) and storage credentials (#116).
