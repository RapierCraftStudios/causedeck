# 0038. The brief is a derived view

## Status

Proposed

## Date

2026-10-25

## Context

A lawyer prepares for a listing from the stage, the last order, the open obligations, what to carry, the case memory and the relevant passages of the file. The data already lives in the docket, the anchored extraction and (later) memory. Storing a second copy would drift from it.

## Decision drivers

- Anchor or drop: no line without provenance.
- A clerk never receives strategy or private court notes, enforced on the server.
- A sensitive (AI-off) matter gets a deterministic brief with no AI and no embedding retrieval.
- Memory (#72) is not built.

## Considered options

| Option                                                  | Verdict  | Reason                                                  |
| ------------------------------------------------------- | -------- | ------------------------------------------------------- |
| Derive the brief on read; store only the lawyer's edits | Chosen   | Never stale against the docket; one small tenant table  |
| Store the assembled brief                               | Rejected | A second source of truth that goes stale                |
| Read memory tables directly                             | Rejected | They do not exist yet; a port lets #74 wire them        |
| Document context by embeddings                          | Rejected | No embedding table; full-text over `document_page` fits |

## Decision

- `assembleBrief` builds the brief per request inside the actor's workspace scope; `BriefLine` and `ObligationLine` refuse a non-manual line without an anchor or a source reference, and assembly drops it.
- `brief_state` (one row per listing, FORCE RLS) keeps the prepared mark, carry edits and a note. A later new order, changed stage or new obligation clears the mark and emits `brief.stale` through an injected port.
- Memory (M2 always-carry, M3 synopsis, M4 court notes) comes through a `MemoryProvider` port, empty by default.
- Context is at most 5 passages by full-text over the matter's own `document_page` rows.
- The last order may be compressed by the gateway's `summarise` task only from anchored directions; the text is kept only if every date in it is in the anchored quote.
- `brief.refresh` and a daily sweep reconcile the mark; the sweep lists targets through the owner-defined `app_brief_refresh_targets()`.

## Consequences

- `briefs` depends on `workspaces`, `audit`, `matter-graph`, `court-day` and `ai`.
- The stage-changed detection treats a later update of the listing row as a stage change.

## Revisit when

- #74 wires memory, or a document embedding table exists.
