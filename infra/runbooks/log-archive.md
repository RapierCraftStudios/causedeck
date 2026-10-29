# Lean log archive runbook (#886)

Owner: Engineering lead
Last drilled: not yet drilled (record: [drills](drills/README.md))

## Purpose

Hosts on the `core` monitoring profile (staging VPS-1, prod VPS-3 at launch) run no Loki. CERT-In still requires 180
days of logs that can be produced on request, in India (D-009). The lean path gzips Docker's JSON logs daily and
uploads them to an India object bucket, `ap-south-2` (Hyderabad) by default, locked 180 days. Design and files:
[monitoring README](../monitoring/README.md). Evidence handling after retrieval: [cert-in-6h](cert-in-6h.md).

## Triggers

A CERT-In or regulator request for logs, a `core` host provisioning, a failed upload (files piling up in
`/var/lib/docker/containers/*/` as `*-json.log-YYYYMMDD.gz`), or the monthly check.

## Roles

On-call primary retrieves logs; the engineering lead approves any export leaving the bucket; counsel confirms what is
disclosed ([cert-in-6h](cert-in-6h.md)).

## Steps

1. **Set up** (once per host). Create or reuse the bucket from #884 (human step, [dr-hyderabad](dr-hyderabad.md)), set
   `LOG_ARCHIVE_ENDPOINT`, `LOG_ARCHIVE_REGION` (default `ap-south-2`), `LOG_ARCHIVE_BUCKET`, `LOG_ARCHIVE_ACCESS_KEY`
   and `LOG_ARCHIVE_SECRET_KEY` in the stack env file from the secret manager. Run
   `archive-logs.sh --check-config`, then `archive-logs.sh --init` once with admin credentials (object lock, 180-day
   COMPLIANCE retention, 200-day expiry).
2. **Install**. Copy `logrotate-docker.conf` to `/etc/logrotate.d/causedeck-docker`, raise Docker's `max-size` to
   `100m` in `/etc/docker/daemon.json`, and enable `causedeck-log-archive.timer`.
3. **Retrieve for a request**. List the dated prefix `docker/<host>/<YYYY-MM-DD>/` with `mc ls`, copy the needed days
   with `mc cp --recursive`, `gunzip`, filter by `request_id` or time. Keep the manifest of keys copied with the
   incident ticket and hash the export ([evidence checklist](templates/evidence-checklist.md)).
4. **Fix a failed upload**. Run `archive-logs.sh --dry-run` to list pending files, then the script without the flag.
   Local files are deleted only after their upload succeeds; logrotate keeps 7 days locally as a safety net.

## Communications

A regulator request goes through the incident commander and counsel; this runbook never contacts anyone. Status of a failed
upload is a P2 ticket ([on-call](on-call.md)), P1 if no upload succeeded for 3 days.

## Evidence

The key manifest, the export hash and the `mc` command log go in the incident ticket; archive objects are
immutable for 180 days, so the originals remain the evidence.

## Verification

`archive-logs.sh --dry-run` lists nothing older than a day, `mc ls` shows yesterday's prefix, and
`mc retention info` on a recent object shows COMPLIANCE for 180 days. The region guard is covered by
`infra/monitoring/test/log-archive.test.ts`. Record a drill in [drills](drills/README.md) after the first retrieval rehearsal.

## After action

Moving the host to the `full` profile restores Loki; keep the archive upload running until Loki has 180 days of its own.
Never shorten the lock or point `LOG_ARCHIVE_REGION` outside India.
