# 0003. PostgreSQL 17 with pgvector, Drizzle and RLS multi-tenancy

## Status

Accepted

## Date

2026-10-18

## Context

Every workspace (a solo advocate or a chamber) is a tenant whose matter data must never leak to another tenant (D-033). Search covers full text and matter-scoped semantic retrieval. At bootstrap everything runs on one India VPS. The spike fixes this in [§1](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (Database and Search rows), [§4.1 Tenancy and RLS](../engineering/13-technical-architecture-spike.md#41-tenancy-and-rls), the §4.2 invariants and [§4.3](../engineering/13-technical-architecture-spike.md#43-migrations-and-seed-data).

## Decision drivers

- Tenant isolation that holds even when application code has a bug.
- One datastore for relational data, the queue (ADR 0005), full-text search and vectors at bootstrap.
- Typed schema and reviewed SQL migrations with expand/contract discipline.
- Provenance on every extracted fact, because a lawyer must be able to trace any date or direction to its source.

## Considered options

| Option                                                  | Verdict  | Reason                                                                                                           |
| ------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| Postgres 17 + pgvector, Drizzle, shared schema with RLS | Chosen   | One database; RLS is a backstop under app policy; Drizzle keeps SQL visible and typed                            |
| Schema-per-tenant or database-per-tenant                | Rejected | Migrations fan out per tenant, and connection pools and operations do not scale to thousands of small workspaces |
| Prisma ORM                                              | Rejected | Weaker support for RLS session settings (`SET LOCAL`) in transactions, and generated SQL is less visible         |
| A separate vector database or search engine             | Rejected | A second datastore to secure and keep in residency; Postgres FTS and pgvector are enough at bootstrap            |

## Decision

- PostgreSQL 17 with pgvector. Drizzle ORM for the schema, and drizzle-kit for migrations (reviewed SQL, expand → migrate → contract).
- Search uses Postgres full-text (`tsvector`, `simple` plus language configurations) and pgvector for matter-scoped semantic retrieval. There is no external search engine at bootstrap.
- Tenancy invariants (spike §4.1, §4.2):
  - **Every tenant table has `workspace_id uuid not null`.**
  - **RLS is keyed by `app.workspace_id`**: the policy is `workspace_id = current_setting('app.workspace_id')::uuid`, and `withWorkspace(tx, wsId)` in `packages/db` sets the GUC with `SET LOCAL` at the start of every transaction.
  - The app database role is **not the owner**, so RLS is enforced. Migrations run as the owner role.
  - **No cross-workspace foreign keys.**
  - **Provenance columns on every fact**: `source_type`, `source_ref`, `anchor_id` (or manual), `confidence` and `confirmation_state`.
- Role permissions are enforced in `packages/core` policy functions, with RLS as the backstop. Clerk denials on strategy and memory are also enforced through column-scoped views.
- A CI-blocking cross-tenant test suite covers SQL, server actions, API, storage presign, vector search, and a user who belongs to two workspaces.

## Consequences

- Positive: an isolation bug in application code fails closed at the database.
- Positive: one backup and restore story (WAL-G) for data, queue and search.
- Negative: every query must run inside `withWorkspace`. Cross-workspace operations (staff support, exports) need explicit, audited paths.
- Negative: Postgres carries search and vector load until Stage C.

## Revisit when

- Spike §3.2 Stage B triggers: p95 latency > 400 ms, DB CPU > 60%, or > 1k seats. Postgres then moves to AWS RDS (ap-south-1) with PITR and a Hyderabad read replica.
- Stage C trigger (> 10k seats): OpenSearch only if Postgres full-text search proves insufficient.
- A requirement appears that needs a cross-workspace reference. This would need a new ADR, because it breaks an invariant.

## Links

- [Spike §4](../engineering/13-technical-architecture-spike.md#4-data-architecture)
- [ADR 0005](0005-pg-boss-job-queue-no-redis.md)
- [DECISIONS.md](../../DECISIONS.md) D-033
