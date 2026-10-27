# 0046. Style learning without training

## Status

Proposed

## Date

2026-10-27

## Context

A lawyer's drafts carry a house style: how prayers are worded, which grounds come first, how annexures are listed. Drafting should reuse that style (#81, #901). Learning it by training or fine-tuning a model on customer drafts would move privileged work product into model weights, which cannot be deleted, audited per client or kept in India.

## Decision drivers

- Customer drafts are privileged and are never used to train a model.
- A lawyer can see, correct and delete everything the system learned.
- Embeddings and any model call stay in India (ADR 0007).
- Nothing is saved without the lawyer confirming it (ADR 0044).

## Considered options

| Option                                                              | Verdict  | Reason                                                              |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| Select and rank the lawyer's own approved passages by similarity    | Chosen   | Reversible, deletable, auditable; no model change                   |
| Fine-tune a model per lawyer or per chamber                         | Rejected | Weights keep the text; deletion and residency cannot be shown       |
| Train a shared style model across workspaces                        | Rejected | Cross-tenant leakage of privileged work product                     |

## Decision

Style learning is selection and ranking of passages the lawyer already approved. It never trains or fine-tunes on customer data.

1. A passage is proposed (L2) from a draft the lawyer exported and saved only after they confirm it. The proposal is a `memory_proposal`; `confirmPrecedentProposal` saves the M5 `memory_item`, the `precedent_passage` and its vector in one transaction. A dismissal records a reason code and the same passage is not proposed again for 30 days.
2. A passage stores the immutable draft version and block it came from. Its text is envelope-encrypted with the workspace key.
3. Search is a SQL-scoped vector search: the workspace is pinned, a row is the caller's own or one an owner shared with the chamber, clerks and viewers are denied.
4. Embeddings come from the India-only route (`packages/ai/src/embeddings.ts`). The default is an in-process mock; a provider embedder is accepted only in an India region. Any other is refused before text is sent, and the refusal is audited (`memory.embedding_refused`, embedder id and region, never text).
5. Deleting a passage or playbook removes its vectors at once; the hourly `memory.purge` sweep is the 24 h backstop.
6. `packages/ai` has no fine-tuning or training client, enforced by a static test.
7. The flag `m5_playbooks` is off by default and on for the demo workspace.

## Consequences

- Style quality depends on retrieval and prompt assembly (#902 to #904), not on learned weights.
- A provider change needs an India-region embedder before it can be used for style search.
- Erasing a lawyer erases their passages and vectors; nothing remains in a model.
