# 0005. pg-boss job queue on Postgres, no Redis

## Status

Accepted

## Date

2026-10-18

## Context

OCR, speech-to-text, extraction, briefs, notifications, digests, imports, exports and retention all run in the background in `apps/worker`. At bootstrap everything runs on one India VPS, and the cost target is about ₹6–12k per month. The spike fixes this in [§1](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (Background jobs row) and in the [§3.2](../engineering/13-technical-architecture-spike.md#32-scale-path-designed-in-from-day-one) day-one rules (idempotent jobs, all state in Postgres and S3).

## Decision drivers

- No extra stateful service to run, secure, back up and keep in India.
- Jobs can be enqueued in the same transaction as the data change that causes them.
- Retries, scheduling (cron), throttling and dead-lettering.

## Considered options

| Option          | Verdict  | Reason                                                                                                                                         |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| pg-boss         | Chosen   | Postgres-backed; transactional enqueue; cron, retries and throttling built in; covered by the existing backups                                 |
| Redis + BullMQ  | Rejected | A second stateful service with its own persistence and backups at bootstrap; no transactional enqueue with Postgres                            |
| AWS SQS         | Rejected | Ties Stage A to AWS; no transactional enqueue; needs a local emulator in dev and CI                                                            |
| Graphile Worker | Rejected | Also Postgres-backed and viable, but it has fewer built-in scheduling and throttling features for our job mix; pg-boss was chosen in the spike |

## Decision

- `apps/worker` runs pg-boss queues on the main Postgres database. Two worker containers run at Stage A.
- **There is no Redis at bootstrap.**
- Every job is idempotent and safe to retry (spike §3.2 day-one rules). Payloads carry the `workspace_id`, and handlers run under `withWorkspace` (ADR 0003).

## Consequences

- Positive: one datastore and one backup. Enqueue is atomic with the triggering write.
- Negative: queue load lands on Postgres, so job volume counts toward DB CPU.
- Negative: rate limiting and caching have no shared in-memory store until Stage C (Caddy rate limits cover the edge).

## Revisit when

- Spike §3.2 Stage B triggers: DB CPU > 60%, p95 latency > 400 ms, or > 1k seats. Workers then move to their own node.
- Stage C trigger: > 10k seats or several teams. Workers are then autoscaled per queue, and Redis (ElastiCache) is added for rate limits and cache. The queue itself moves off pg-boss only through a new ADR.

## Links

- [Spike §3.2](../engineering/13-technical-architecture-spike.md#32-scale-path-designed-in-from-day-one)
- [ADR 0003](0003-postgres-17-pgvector-drizzle-rls-multitenancy.md)
