# Runbook: workspace deletion

Workspace deletion (#302) is automatic: an owner requests it, 14 days of cooling-off follow, then
`system.deletion.tick` enqueues `deletion.erase`, which erases the workspace and writes a tombstone.
Design: [docs/engineering/data-lifecycle.md](../../docs/engineering/data-lifecycle.md). This page is
for when something needs a person.

## Inspect a deletion

Connect as the owner role (it can read `deletion_job` through `owner_definer_read`):

```sql
select id, workspace_id, status, cooloff_until, created_at, steps
from deletion_job where kind = 'workspace' and status <> 'cancelled'
order by created_at desc limit 20;
```

`steps` shows each finished step (`revoke`, `dek`, `blobs`, `rows`, `receipt`) with its times and
counts, and `failure.code` after the last retry failed. An erased workspace has no job row any more;
look in `deletion_tombstone` instead.

## A deletion is stuck or failed

The erase is resumable and idempotent, so re-running it is always safe.

1. Find the job (above) and read `steps.failure.code` and the worker logs for `deletion.erase`
   (ids and codes only).
2. Fix the cause (object store or database unavailable, email transport down, ...).
3. Set the job back to `scheduled` and let the next hourly tick enqueue it, or enqueue it now:
   `enqueue('deletion.erase', { workspaceId, jobId })` from a worker shell. It resumes after the last
   finished step.

The SLA is 24 h after the cool-off ends, with a hard limit of 30 days from the request. Escalate a
deletion still unfinished 7 days after its cool-off ended.

## Cancel

During the cool-off any owner cancels in the app (#305). Operators do not cancel on a customer's
behalf without a written request from an owner of that workspace. A `running` erase cannot be
cancelled: the key may already be destroyed.

## Verify a completed deletion

```sql
select workspace_id, deleted_at, receipt_hash, receipt from deletion_tombstone where workspace_id = $1;
```

- The object store has no key under `ws/<workspace id>/`.
- A count of rows with `workspace_id = $1` in every tenant table is zero (the crypto-erase test does
  exactly this).
- `receipt.signature` verifies with `verifyDeletionReceipt` and the server secret.

## Receipt requests

The requester received the receipt by email before the final step. If they ask again, send the
`receipt` JSON and `receipt_hash` from the tombstone. It contains no workspace content.

## Legal hold

Issued SaaS invoices of an erased workspace stay in `legal_hold_invoice` in minimal form (no names,
addresses or line descriptions) until `retain_until`. The rule and its field list await
counsel/CA confirmation (#31). Purging rows past `retain_until` is a future retention job; until
then they stay.

## Backups

Database backups and object storage versions expire on the Production Infra retention schedule. A
restored backup still cannot decrypt the workspace's objects or fields: the DEK was zeroed before
the purge and is not in any later backup. Never restore a deleted workspace's rows from a backup.
