# 0038. Memory scopes, confirm-before-save, the clerk view and the no-judge rule

## Status

Proposed

## Date

2026-10-25

## Context

Lawyer memory (#72, PRD ME-1..ME-4) keeps what the OS learned about one lawyer: profile (M1), working preferences (M2), matter memory (M3), private court notes (M4), relationship memory (M6) and recognition aliases (M7). It is the most personal data in the product. It must never be saved without the lawyer's say, never cross a matter or a workspace, never reach a clerk when it is strategy, never describe a judge or a bench (D-050), and must be erasable.

## Decision drivers

- A lawyer confirms every memory the machine proposes.
- Scope must hold even when a query forgets its predicate.
- A clerk must not be able to read M3, M4 or strategy values, even through a bug.
- Values are client-confidential: envelope-encrypted, never in logs, audit metadata or evidence.

## Considered options

| Option                                                              | Verdict  | Reason                                                                         |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| Proposals in `memory_proposal`, items only from `confirmMemory`     | Chosen   | One writer of `memory_item` besides the lawyer's own note; testable statically |
| Save as `unconfirmed` items and filter on read                      | Rejected | A forgotten filter would use unconfirmed memory                                |
| App-level scope checks only                                         | Rejected | One missed `where` leaks a matter                                              |
| RLS scope policies plus the same predicates in the query            | Chosen   | Defence in depth: the policy backs the predicate                               |
| Clerk reads `memory_item` through the app role with a column filter | Rejected | The grant would expose every column                                            |
| Column-scoped view `memory_item_clerk_v` and a policy function      | Chosen   | Precedent in `0022_matter_restriction`; the clerk role has no table privilege  |

## Decision

1. **Confirm before save.** `proposeMemory`, `proposeFromEdit` and `proposeFromCorrection` write `memory_proposal` only. `confirmMemory` (the lawyer confirms, optionally correcting the value) and `createMemoryNote` (a note the lawyer wrote) are the only writers of `memory_item`; a test scans the core source for any other insert. The `memory_item` automation handler stays at L2 and saves through `acceptMemoryDraft`, which is the same propose-then-confirm path.
2. **Scopes.** Scope is `user`, `workspace` or `matter`; M3 is matter-scoped and nothing else is. Table checks tie `scope` to `matter_id`, M3 to matter scope, M6 to a person and chamber sharing to M4. Restrictive RLS policies add to the `ws_isolation` policy: a user-scope item is visible to its owner only (or to the chamber when an owner shared an M4 note), and when the transaction pins `app.matter_id` a matter-scoped row is visible for that matter only. Reads also carry the same predicates (`readablePredicate`), and `canReadMemory` is the same rule for a row in hand.
3. **M4 and sharing.** An M4 court note is private to its author. Sharing it with the chamber needs the owner role and is audited as `memory.sharing_changed` (ids only).
4. **Clerk view.** A clerk reads M1, M2, M6 and M7 values that are not strategy-typed, through `memory_item_clerk_v` (no source, anchor, confidence or proposal columns) and the function `memory_clerk_readable`. The clerk role has no privilege on `memory_item`, `memory_proposal` or `memory_embedding`. A viewer reads no memory.
5. **Encryption.** Values are sealed with `encryptField` under the workspace data key (AAD = workspace id; `packages/storage/src/field-crypto.ts`, unchanged) before they reach a row. Evidence and audit metadata hold ids and counts, never values. Embeddings come from an injected embedder: the default runs in process, a provider-backed one must run in India and is refused for a sensitive matter. No memory content is used for training.
6. **No judge or bench.** Keys with a judge or bench word and values that describe a judge or a bench are rejected (`assertNotBench`) at proposal, note, confirm and edit, with a clear error. Memory holds the lawyer's own practical notes only.
7. **Pause, delete, purge.** Pause-all is a per-member row in `memory_pause`: while it exists no proposal is filed and no memory is read for an output. Deleting an item removes its value at once and keeps a tombstone for usage history; the `memory.purge` sweep (hourly) deletes the embeddings of deleted items, inside the 24 h limit. A repeated edit pattern is counted in an `observing` proposal row, shown only once it reaches three distinct outputs; a dismissed proposal rests 60 days.

## Consequences

- Positive: a missed predicate or a clerk bug still cannot return another matter's or a strategy value; proposals never become memory unseen.
- Negative: two checks (policy and predicate) per read; a deleted item leaves a row until the workspace is erased (`memory.erase`, #303, deletes by `workspace_id`, embeddings first).
- Follow-up: a provider-backed embedding task in the AI gateway; the memory UI (#73).
