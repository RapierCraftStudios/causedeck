# 0053. Stage B and C scale path

## Status

Proposed

## Date

2026-10-25

## Context

Stage A is one India VPS running the compose stack (#99, #100). Stage B moves the database and documents to AWS India managed services and adds a second app node (#106). Stage C is orchestration, and it stays a skeleton until measured triggers fire. Matter data must stay in India and must not transit a Cloudflare edge unless D-037 is recorded as allowing it. Nothing here is applied automatically: apply is manual and gated, like #99 (the workflow offers no stage-b apply until a reviewed change adds it behind a reviewer-gated environment).

## Decision drivers

- India residency (D-037) with TLS terminating in India.
- The same app images and env-only configuration across stages.
- No new moving parts before a trigger justifies them.
- Cost per active seat inside the PRD §8 variable-cost target.

## Considered options

| Option                                             | Verdict  | Reason                                                                     |
| -------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| AWS ALB in ap-south-1 as the multi-node entry      | Chosen   | TLS terminates in India, DNS-only records keep the #99 rule                |
| Cloudflare Load Balancer in front of the nodes     | Optional | Needs `residency_decision_ref` and a documented approval; off by default   |
| RDS Postgres 17 with a Hyderabad read replica      | Chosen   | Managed backups with PITR, CMK encryption, India-only regions              |
| ECS Fargate for Stage C                            | Chosen   | No cluster to run; per-queue worker services scale on queue depth          |
| k3s for Stage C                                    | Rejected | Cluster operations cost more than the founder team can carry               |
| Redis, OpenSearch, PowerSync before their triggers | Rejected | Each adds an operated component; criteria are measurable (Stage C runbook) |

## Decision

- Stage B triggers: p95 above 400 ms, database CPU above 60%, or more than 1,000 seats. The runbook is `infra/runbooks/stage-b-scale-out.md`.
- Terraform modules `aws-rds-postgres`, `aws-s3-documents`, `aws-alb-multinode`, `cloudflare-lb`, and the Stage C skeletons `aws-ecs-fargate` and `aws-elasticache` (`enabled = false`), composed in `envs/stage-b`. Region variables accept only `ap-south-1` and `ap-south-2`.
- The ALB is the default entry. `cloudflare-lb` cannot be enabled without `residency_decision_ref` and `approval_doc`, matching `app_proxied`.
- Stage C criteria (ECS Fargate versus k3s, Redis, OpenSearch, PowerSync) each have a measured trigger in `infra/runbooks/stage-c-orchestration.md`. This ADR is the review of those criteria.
- The envelope KEK moves from env and secret manager to KMS with a DEK re-wrap (`rewrapAll`), as described in the Stage B runbook and `docs/engineering/storage.md`.

## Consequences

- The Stage B root is validated and planned in CI with dummy credentials and is not an apply or drift target.
- The migration and MinIO sync rehearsals are post-deploy; the scripts and the results template are delivered.
- Stage C stays a document and skeletons until a trigger fires.

## Revisit when

- D-037 is recorded as allowing the Cloudflare proxy for app traffic.
- Any Stage C trigger fires, or seats pass 5,000.
