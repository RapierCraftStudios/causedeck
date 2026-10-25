# 0014. Forum catalogue: hosts as data, new-window deep links, owner-role versioned seed

## Status

Proposed

## Date

2026-10-21

## Context

CauseDeck launches in Chennai and Bengaluru (PRD CL-1). Every matter sits before a forum, so the product needs a catalogue of the Madras High Court and Karnataka High Court benches and the Chennai and Bengaluru subordinate courts, tribunals and commissions (#34). [ADR 0013](0013-matter-graph-schema.md) created the `forum` table as a global-or-workspace table: a null `workspace_id` is a system catalogue row, written only by the owner role. Research ([launch markets](../strategy/11-launch-markets-madras-hc-bengaluru.md) §2) found two constraints. Official hostnames are unstable: Madras HC alone spreads its services over four hosts, and the legacy Karnataka host no longer answers. And Madras HC allows hyperlinking but forbids framing its pages. Several of these pages sit behind captchas; the product never fetches them.

## Decision drivers

- A host or page change must be a data change, not a code release.
- No court page may be embedded; links open in a new window without opener access.
- The catalogue must be re-applied safely on every deploy, without deleting rows that proceedings reference.
- Only the owner role may write catalogue rows (ADR 0013), and the app-role seed registry cannot.

## Considered options

| Option                                                                | Verdict  | Reason                                                                                                       |
| --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| Typed seed data with ordered `config.hosts`, applied by `db:migrate`  | Chosen   | Hosts and templates are reviewed data; the owner already runs on every deploy; one idempotent upsert         |
| Hostname constants in service or adapter code                         | Rejected | A host move needs a release; hosts drift between packages                                                    |
| Embedding court pages in an iframe                                    | Rejected | Madras HC forbids framing; captcha pages would break inside a frame anyway                                   |
| Register the catalogue in the app-role seed registry (`pnpm db:seed`) | Rejected | RLS rejects catalogue writes from the app role; `db:seed` is not a deploy step                               |
| Delete catalogue rows that the data no longer lists                   | Rejected | `proceeding.forum_id` references forums (ON DELETE RESTRICT); history must keep its forum                    |
| A data migration per catalogue change                                 | Rejected | Migrations are append-only SQL; a forum edit would need a new migration and a regenerated snapshot each time |

## Decision

- **Seed data.** The catalogue is `ForumSeed[]` per market in `packages/db/src/seed/forum-catalogue/` (`madras-hc.ts`, `karnataka-hc.ts`, `chennai-district.ts`, `bengaluru-district.ts`, `tribunals.ts`), parsed at load with `ForumSeedSchema` from `@causedeck/validators/forum`. Codes are stable dotted slugs (`in.tn.madras-hc.principal.original`). Madurai, Dharwad and Kalaburagi are present with `enabled = false` and `config.disabledReason` (CL-12, v2). No case types, halls, rosters or judges are seeded: the adapters own them (#36, #37, #39).
- **Hosts are data.** `config.hosts` is an ordered list (preferred first). `ForumConfigSchema` is strict: hosts, `deepLinks` (templates per page kind), `disabledReason`, `notes`, and nothing else, so no `embed` flag can be stored. An ESLint `no-restricted-syntax` rule in `packages/core` rejects any `*.tn.gov.in`, `*.karnataka.gov.in` or `nclt.gov.in` literal.
- **Deep links.** `resolveDeepLink(forum, kind, params)` in `@causedeck/core/court` returns `{ url, fallbacks, target: '_blank', rel: 'noopener noreferrer' }`: a relative template on the first host, the same path on the other hosts as fallbacks; an absolute template keeps its own host. Disabled forums and missing pages return null.
- **Seeding.** `seedForumCatalogue(db)` runs as the owner from `pnpm db:migrate`, after the migrations, in one transaction: an upsert keyed by `forum_scope_code_uq` that updates a row only when its data differs (unchanged rows keep `updated_at`), a soft-disable of catalogue rows the data no longer lists, and `FORUM_CATALOGUE_VERSION` recorded in the global `catalogue_meta` table (migration 0042; the app role may only read it).
- **Custom forums.** `createWorkspaceForum` adds an A0 forum to the actor's workspace (`matter.write`); a code already used by a catalogue forum or by the workspace is a conflict. RLS keeps it invisible to other workspaces.

## Consequences

- Positive: a host move, a new page or a new forum is a reviewed data change plus a version bump, applied by the next deploy.
- Positive: framing is impossible by construction, and the hostname lint keeps hosts out of service code.
- Negative: `db:migrate` now writes data as well as schema; a broken catalogue entry fails the deploy step (it is validated at load and by unit tests first).
- Negative: soft-disabled rows stay in the table; readers must filter on `enabled`.

## Revisit when

- A forum outside the two launch markets is catalogued, or catalogue data needs per-environment differences.
- An adapter needs host health checks or automatic host failover (#35).
- A court publishes a policy that allows embedding, or forbids deep links.

## Links

- [ADR 0013](0013-matter-graph-schema.md)
- [Launch markets](../strategy/11-launch-markets-madras-hc-bengaluru.md)
- [Core domains](../engineering/core-domains.md)
- Issues: #34 (this decision), #35 (adapter framework), #36, #37, #38 (adapters), #39 (rosters), #42 (courts UI)
