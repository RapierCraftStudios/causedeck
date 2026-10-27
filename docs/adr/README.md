# Architecture decision records

This directory is the numbered log of CauseDeck's architecture decisions. The [technical architecture spike](../engineering/13-technical-architecture-spike.md) is the build contract. It changes only through an ADR here, so later work cites an ADR number instead of editing the spike.

ADRs 0001-0010 record decisions that were already accepted in the spike (§1, §3, §6, §7, §10) and in [DECISIONS.md](../../DECISIONS.md) D-036 to D-041. They add no new decisions.

## Index

| ADR | Title | Status | Date | Supersedes |
| --- | ----- | ------ | ---- | ---------- |
| [0001](0001-monorepo-pnpm-turborepo.md) | Monorepo with pnpm workspaces and Turborepo | Accepted | 2026-10-18 | — |
| [0002](0002-nextjs-app-router-node-runtime-india-residency.md) | Next.js App Router on the Node runtime with India data residency | Accepted | 2026-10-18 | — |
| [0003](0003-postgres-17-pgvector-drizzle-rls-multitenancy.md) | PostgreSQL 17 with pgvector, Drizzle and RLS multi-tenancy | Accepted | 2026-10-18 | — |
| [0004](0004-better-auth-and-organization-as-workspace.md) | Better Auth with the organization plugin as workspaces | Accepted | 2026-10-18 | — |
| [0005](0005-pg-boss-job-queue-no-redis.md) | pg-boss job queue on Postgres, no Redis | Accepted | 2026-10-18 | — |
| [0006](0006-s3-abstraction-minio-to-s3-and-envelope-encryption.md) | S3-compatible storage from MinIO to S3, with envelope encryption | Accepted | 2026-10-18 | — |
| [0007](0007-ai-gateway-india-only-mode-no-training-no-tools.md) | AI gateway with India-only mode, no training and no tools | Accepted | 2026-10-18 | — |
| [0008](0008-design-system-tailwind4-shadcn-oklch-tokens.md) | Design system on Tailwind CSS v4, shadcn/ui and OKLCH tokens | Accepted | 2026-10-18 | — |
| [0009](0009-offline-pwa-serwist-dexie-indexeddb.md) | Offline PWA with Serwist and Dexie on IndexedDB | Accepted | 2026-10-18 | — |
| [0010](0010-feature-flags-db-backed-legal-gating-and-no-l5.md) | DB-backed feature flags, legal gating and no L5 actions | Accepted | 2026-10-18 | — |
| [0011](0011-access-mode-registry-closed-enum.md) | Access-mode registry closed enum | Proposed | 2026-10-19 | — |
| [0012](0012-core-package-split-threshold.md) | Split @causedeck/core into domain packages at a threshold | Proposed | 2026-10-20 | — |
| [0013](0013-matter-graph-schema.md) | Matter-graph schema: composite tenant keys, global-or-workspace reference tables, case identity | Proposed | 2026-10-21 | — |
| [0014](0014-forum-catalogue-and-deep-links.md) | Forum catalogue: hosts as data, new-window deep links, owner-role versioned seed | Proposed | 2026-10-21 | — |
| [0015](0015-court-adapter-framework.md) | Court adapter framework: no network, registry-enforced access, config versus parser | Proposed | 2026-10-21 | — |
| [0016](0016-proceeding-state-machine-and-next-date-rules.md) | Proceeding state machine and canonical next-date rules | Proposed | 2026-10-21 | — |
| [0017](0017-effective-dated-rosters.md) | Effective-dated bench rosters | Proposed | 2026-10-21 | — |
| [0018](0018-madras-hc-adapter-assumptions.md) | Madras HC adapter assumptions | Proposed | 2026-10-22 | — |
| [0019](0019-karnataka-hc-adapter-assumptions.md) | Karnataka HC adapter: layout assumptions and how H13 retires them | Proposed | 2026-10-22 | — |
| [0020](0020-nclt-bengaluru-table-parsing.md) | NCLT Bengaluru cause lists: table parsing from word coordinates | Proposed | 2026-10-21 | — |
| [0021](0021-capture-inbox-and-upload-pipeline.md) | Capture inbox and upload pipeline | Proposed | 2026-10-22 | — |
| [0022](0022-ai-gateway-implementation.md) | AI gateway implementation: ports, residency, audit and idempotent results | Proposed | 2026-10-22 | — |
| [0023](0023-automation-ladder-and-undo.md) | Automation ladder, proposals and undo cascades | Proposed | 2026-10-22 | — |
| [0024](0024-ics-import-and-private-feed.md) | ICS import and the private calendar feed | Proposed | 2026-10-23 | — |
| [0025](0025-document-pipeline.md) | Document pipeline: ports, text layer first, OCR through the gateway | Proposed | 2026-10-23 | — |
| [0026](0026-pwa-share-target-and-outbox.md) | PWA share target and encrypted outbox | Proposed | 2026-10-23 | — |
| [0027](0027-whatsapp-import-browser-parsing.md) | WhatsApp import: parse in the browser, upload the selection | Proposed | 2026-10-23 | — |
| [0028](0028-anchored-extraction.md) | Anchored order extraction: deterministic first, validator last | Proposed | 2026-10-23 | — |
| [0029](0029-voice-capture-and-spoken-date-validation.md) | Voice capture: transcribe, structure with spans, and validate every spoken date | Proposed | 2026-10-23 | — |
| [0030](0030-diary-photo-capture-and-image-anchors.md) | Diary-photo capture and image-region anchors | Proposed | 2026-10-23 | — |
| [0031](0031-email-forward-in-and-parser-registry.md) | Email forward-in: inbound webhook, providers and the `email.intake` job | Proposed | 2026-10-23 | — |
| [0032](0032-generic-a0-adapter.md) | A0 generic adapter: skeleton first, anchored model pass, always L2 | Proposed | 2026-10-23 | — |
| [0033](0033-bootstrap-import-plan-and-apply.md) | Bootstrap import: a stored plan, a confirm grid, one apply and an undo | Proposed | 2026-10-23 | — |
| [0034](0034-governed-fetch-layer.md) | Governed fetch layer | Proposed | 2026-10-23 | — |
| [0035](0035-data-ops-alerting.md) | Data operations alerting | Proposed | 2026-10-23 | — |
| [0036](0036-bench-facts.md) | Internal bench facts and the flagged bench card | Proposed | 2026-10-24 | — |
| [0037](0037-court-day-read-model.md) | The court day read model | Proposed | 2026-10-24 | — |
| [0038](0038-brief-as-derived-view.md) | The brief is a derived view | Proposed | 2026-10-25 | — |
| [0039](0039-reminder-scheduling.md) | Court-day reminder scheduling | Proposed | 2026-10-25 | — |
| [0040](0040-court-day-board-interaction-model.md) | The court-day board interaction model | Proposed | 2026-10-25 | — |
| [0041](0041-brief-print-via-css.md) | Brief printing through a print stylesheet | Proposed | 2026-10-25 | — |
| [0042](0042-offline-encrypted-store-and-key-lifecycle.md) | Offline encrypted store and key lifecycle | Proposed | 2026-10-25 | — |
| [0043](0043-corpus-storage-enrichment-and-retrieval.md) | Corpus storage, enrichment and retrieval | Proposed | 2026-10-27 | — |

## Statuses

| Status | Meaning |
| ------ | ------- |
| `proposed` | Open for review. Not yet binding. |
| `accepted` | Binding. Implementation issues cite it. |
| `superseded` | Replaced by a later ADR. Put that ADR's number in the later ADR's Supersedes column and link it from this ADR's Links section. |
| `deprecated` | No longer applies, and nothing replaces it. |

## Proposing an ADR

1. Run `pnpm adr:new "Short decision title"`. It copies [the template](0000-template.md) to the next free number with Status `Proposed` and today's date, and adds a row to the index above.
2. Fill in every section. Considered options is a table with at least two rejected alternatives. Revisit when lists concrete, observable triggers.
3. Open a pull request. When it is approved, set Status to `Accepted` in both the ADR and the index row. If it replaces an earlier ADR, mark that one `Superseded` and fill in the Supersedes column.

Authoring rules:

- An ADR records one decision. It is concise and factual, about one page.
- Never edit the decision of an accepted ADR. Write a new ADR that supersedes it.
- If you find an inconsistency in the spike, do not resolve it silently. Open a new ADR with Status `Proposed` that flags it.

## Checks

- `pnpm adr:lint` checks numbering contiguity, file names, required sections, status and date, and that this index matches every ADR. CI runs it in the `lint` job.
- `pnpm adr:test` runs the unit tests for the ADR scripts (`docs/adr/scripts`).
- `pnpm docs:links` checks that relative links and anchors in `docs/adr` and the spike resolve.
- `pnpm format:check` covers `docs/adr` with Prettier. The other documents in `docs/` are not reformatted.
