# Stage C orchestration criteria (#106)

Stage C is a decision document plus disabled skeletons (`infra/terraform/modules/aws-ecs-fargate`,
`aws-elasticache`, both `enabled = false`). Nothing here is built until a trigger below fires. The
decision is reviewed in [ADR 0051](../../docs/adr/0051-stage-b-c-scale-path.md). Stage B is
`stage-b-scale-out.md`. Nothing is applied automatically.

A trigger counts when it holds for two consecutive weeks, measured on the Stage B system, unless noted.

## ECS Fargate versus k3s

Decision: **ECS Fargate**. It has no cluster or nodes to patch, uses the same container images and
env-only config as Stage A and B, and is billed per task. k3s is chosen instead only if one of these
holds, because it then saves money or removes a limit:

| Condition for k3s                                                                | Measure                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------- |
| Fargate compute is the largest cost line and above 35% of the monthly infra bill | cost report, two months                        |
| A workload needs host features Fargate lacks (GPU, privileged, large local disk) | a concrete workload that cannot run on Fargate |
| The team has an engineer who has run k3s in production for at least 6 months     | named person                                   |

Fargate is also the trigger to leave Stage B nodes: web or worker CPU above 70% on both nodes at
peak, or deploys needing more than 2 nodes.

## Per-queue worker autoscaling

pg-boss queues stay on Postgres (ADR 0005). On Fargate each queue that needs it gets its own worker
service (`worker_queues` in the module). Scale out when queue depth (created plus retry jobs) stays
above 500 for 10 minutes or the oldest job waits longer than its queue's SLO (60 s for capture and
sync, 15 min for imports and OCR); scale in below 50 for 30 minutes. Minimum 1 task per queue,
maximum bounded by the database connection budget (each task counts against RDS `max_connections`).

## Redis (ElastiCache)

Not introduced for pg-boss. Introduce it only when any holds:

| Trigger                                                                  | Measure                               |
| ------------------------------------------------------------------------ | ------------------------------------- |
| Rate-limit or cache reads cost more than 15% of Postgres CPU             | `pg_stat_statements` share            |
| Rate-limit counters in Postgres show p95 above 20 ms on the request path | request timing                        |
| Cross-node cache invalidation is needed for more than 3 features         | list in the issue that proposes Redis |

## OpenSearch

Postgres full text and pgvector stay the search. Introduce OpenSearch only when:

| Trigger                                                                      | Measure             |
| ---------------------------------------------------------------------------- | ------------------- |
| Search p95 above 800 ms after indexing and query tuning                      | search timing       |
| The corpus above 50 million indexed rows or 500 GB of text                   | table sizes         |
| A required feature (faceting, multilingual analysers) cannot be built in SQL | written requirement |

## PowerSync

The offline cache and capture queue (ADR 0009) stay client-side. Introduce a sync service only when:

| Trigger                                                             | Measure              |
| ------------------------------------------------------------------- | -------------------- |
| Sync conflicts above 0.5% of queued writes over a month             | conflict counter     |
| More than 3 entity types need offline editing, not capture only     | product scope        |
| Mobile clients need partial replication of more than 50 MB per user | cache size telemetry |

## Cost model (INR per month, per 1,000 seats)

Indicative, about ₹85 per USD, list prices, ap-south-1; confirm before ordering. Seats are active
paid seats; infrastructure is part of the variable cost. PRD §8
([03-prd.md](../../docs/product/03-prd.md)): variable cost at most ₹175 per active seat per month at
launch and at most ₹110 by month 6. The remainder goes to AI, OCR, messaging and email, so infrastructure
is budgeted at most **₹60 per seat** (about a third of ₹175, leaving at least ₹115 for those).

| Item (per 1,000 seats)                  | Stage A (one VPS)  | Stage B (RDS, 2 nodes, ALB) | Stage C (Fargate, Redis) |
| --------------------------------------- | ------------------ | --------------------------- | ------------------------ |
| Compute                                 | 8,200 (8 vCPU VPS) | 12,000 (2 app nodes)        | 25,500 (Fargate tasks)   |
| Database (primary, replica)             | in compute         | 31,600 (Multi-AZ + replica) | 67,000                   |
| Storage, backups, documents             | 3,800              | 7,100                       | 9,000                    |
| Load balancer, KMS, network, monitoring | 0                  | 7,100                       | 8,000                    |
| Redis                                   | 0                  | 0                           | 4,300                    |
| **Total**                               | **12,000**         | **57,800**                  | **113,800**              |
| **Per seat**                            | **₹12**            | **₹58**                     | **₹114**                 |
| Within the ₹60 infrastructure budget    | yes                | yes (₹2 margin)             | no                       |

Reading: Stage B fits the budget at 1,000 seats with little margin. Stage C is costed as the
same 1,000 seats on a bigger footprint and does not fit; it pays only when the fixed part is shared
by many more seats. At 5,000 seats the Stage C bill is estimated at ₹160,000 (about ₹32 per seat),
which is why Stage C is triggered by measured limits and about 5,000 seats, not earlier. Re-run this
table from the real bill after the Stage B cutover and replace the estimates.
