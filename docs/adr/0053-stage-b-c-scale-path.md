# 0053. Stage B and C scale path

## Status

Proposed

## Date

2026-10-25

## Context

Stage A is one India VPS running the compose stack (#99, #100). Stage B splits state off it and adds a second app node (#106, #887). Stage C is orchestration, and it stays a skeleton until measured triggers fire. Matter data must stay in India and must not transit a Cloudflare edge unless D-037 is recorded as allowing it. The D-037 amendment (2026-10-27, #882) moved Stage A to OVH Mumbai (prod VPS-3, staging VPS-1, separate hosts) and made rented servers the default scale path; this ADR was first written with AWS India managed services as the Stage B default and is amended to match. Nothing here is applied automatically: apply is manual and gated, like #99 (the workflow offers no stage-b apply until a reviewed change adds it behind a reviewer-gated environment).

## Decision drivers

- India residency (D-037, D-009) with TLS terminating in India.
- The same app images and env-only configuration across stages.
- No new moving parts before a trigger justifies them.
- Cost per active seat inside the PRD §8 variable-cost target: rented servers cost a fraction of managed services at this size.
- Founder-team operability: a few boxes and compose are within reach; a cluster is not yet.

## Considered options

| Option                                                                    | Verdict        | Reason                                                                                          |
| ------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| Postgres on its own OVH Mumbai VPS with a streaming replica and PgBouncer | Chosen         | Smallest step from Stage A, same image and WAL-G archiving, no new vendor, lowest cost          |
| 2+ stateless app VPS behind DNS round-robin (DNS-only)                    | Chosen         | TLS terminates in India on each node, keeps the #99 DNS-only rule, no extra component           |
| Cloudflare Load Balancer in front of the app nodes                        | Optional       | Needs `residency_decision_ref` and a documented approval; off by default                        |
| MinIO stays on the Mumbai hosts, off-host backups to S3 ap-south-2        | Chosen         | Documents stay on the box until volume justifies S3; the backup bucket is already in Hyderabad  |
| AWS RDS Postgres 17 with a Hyderabad read replica                         | Optional       | Managed PITR and CMK encryption; kept as `envs/stage-b` (plan-only) if the team prefers managed |
| AWS S3 ap-south-1 or ap-south-2 for documents                             | Optional       | Moves when document volume or durability needs outgrow MinIO                                    |
| AWS ALB in ap-south-1 as the multi-node entry                             | Optional       | Pairs with the AWS variant; DNS-only records keep the #99 rule                                  |
| k3s or Docker Swarm for Stage C on the same boxes                         | Chosen (later) | Reuses the rented servers; decided only when a Stage C trigger fires                            |
| ECS Fargate for Stage C                                                   | Optional       | The AWS-side skeleton (`aws-ecs-fargate`, `enabled = false`)                                    |
| Redis, OpenSearch, PowerSync before their triggers                        | Rejected       | Each adds an operated component; criteria are measurable (Stage C runbook)                      |

## Decision

- Stage B triggers: p95 above 400 ms, database CPU above 60%, or more than 1,000 seats (spike §3.2). The runbook is `infra/runbooks/stage-b-scale-out.md`, with the cost of each stage from the OVH catalogue.
- **Default path (rented servers, OVH Mumbai `YNM` only):** a Postgres primary on its own VPS (VPS-4, or a dedicated server by hand when outgrown) and a streaming replica on a second, each behind PgBouncer in transaction pooling (`infra/docker/compose.db.yml`); the primary archives WAL with WAL-G to the Hyderabad bucket; two or more app VPS on `compose.prod.yml`, reached by DNS-only records (or the optional Cloudflare LB). Terraform root `infra/terraform/envs/stage-b-ovh` orders the nodes through `modules/vps-ovh-mumbai` and refuses any datacenter but `YNM`. The cutover from Stage A is logical replication then promote (`infra/scripts/stage-b/migrate-compose-to-dedicated-postgres.sh`).
- **Optional AWS path:** the Terraform modules `aws-rds-postgres`, `aws-s3-documents`, `aws-alb-multinode`, `cloudflare-lb` and the Stage C skeletons `aws-ecs-fargate` and `aws-elasticache` (`enabled = false`) stay, composed in `envs/stage-b`, which is plan-only in CI. Region variables accept only `ap-south-1` and `ap-south-2`. `migrate-postgres-to-rds.sh` remains for this path.
- The ALB (AWS path) or DNS (default path) is the entry. `cloudflare-lb` cannot be enabled without `residency_decision_ref` and `approval_doc`, matching `app_proxied`; app and API stay DNS-only.
- Stage C criteria (k3s or Docker Swarm on the rented servers versus ECS Fargate, Redis, OpenSearch, PowerSync) each have a measured trigger in `infra/runbooks/stage-c-orchestration.md`. This ADR is the review of those criteria.
- The envelope KEK keeps coming from env and the secret manager on the default path; it moves to KMS with a DEK re-wrap (`rewrapAll`) only on the AWS path, as described in the Stage B runbook and `docs/engineering/storage.md`.

## Consequences

- The database tier is operated by us: replication health, failover and upgrades are runbook steps, not a managed feature. Failover is a manual promotion of the replica (the runbook lists the steps); automatic failover is out of scope until a Stage C trigger.
- OVH VPS have no private network or per-instance firewall API: the database ports are public addresses limited by the host firewall, TLS and SCRAM. This is a known weakness, mitigated by `bootstrap-vps.sh` (ufw) and pinned allowlists, and it is a reason to move to a dedicated server with vRack when the database outgrows VPS-4.
- The Stage B roots are validated in CI (`stage-b` also planned with dummy AWS credentials, `stage-b-ovh` tested with a mocked provider) and are not apply or drift targets.
- The migration and MinIO sync rehearsals are post-deploy; the scripts and the results template are delivered.
- Stage C stays a document and skeletons until a trigger fires.

## Revisit when

- D-037 is recorded as allowing the Cloudflare proxy for app traffic.
- Any Stage C trigger fires, or seats pass 5,000.
- Postgres outgrows VPS-4 (move to a dedicated server with vRack and a private network) or replica lag cannot be held under 5 s.
