# Corpus embedding model (#895)

ADR 0051 §Vectors: segment embeddings live in `judgment_segment.embedding` (`halfvec`, cosine). This report
records the model choice. The comparison harness is `compareModels` in
`packages/intelligence/src/research/eval/embedding-ranker.ts`, run over the #891 pinned set
(`fixtures/research-eval`, 15 synthetic queries).

## Results on the #891 set

| Model                               | Dims | nDCG@10 | recall@50 | Cost, INR per 1M tokens |
| ----------------------------------- | ---- | ------- | --------- | ----------------------- |
| `mock-embed` (hashing, measured)    | 1024 | 0.9753  | 1.0000    | 0                       |
| `cohere.embed-multilingual-v3`      | 1024 | pending | pending   | 8.40 (USD 0.10)         |
| `amazon.titan-embed-text-v2:0`      | 1024 | pending | pending   | 1.68 (USD 0.02)         |
| `bge-m3` (self-hosted)              | 1024 | pending | pending   | 0 per token (instance)  |

The mock number only shows the harness works on a synthetic set that shares vocabulary with its queries; it
says nothing about the real models. Real-provider numbers need Bedrock credentials (#112) and are the
post-deploy run tracked as R18 on #895. Rates use the planning rate of INR 84 per USD (`EMBED_PRICES` in
`packages/ai/src/pricing.ts`, stored as paise per million tokens: 840, 168, 0).

## Selection rule

Default to the cheapest model within 2 nDCG@10 points (0.02) of the best (`selectModel`, `NDCG_TOLERANCE`).
Until the real numbers exist the choice is made on the rule's inputs we do have: all three candidates
support 1024 dimensions and Indian-language text, and Titan is the cheapest hosted model.

## Chosen model and dimensions

- Dimensions: **1024** (`CORPUS_EMBEDDING_DIMENSIONS`). Titan v2 also offers 512 and 256; Matryoshka-style
  truncation is unproven on Indian legal text, so 1024 stays.
- Model: set by the R18 run applying the rule above; the job stores the model version per segment, so
  switching re-embeds through `system.corpus.embed` without a migration while the width stays 1024.
  A change of width needs a migration that alters the `halfvec` column and rebuilds the indexes.

## Indexes and cost budget

- Per-partition HNSW (`halfvec_cosine_ops`, m=16, ef_construction=64) is created in the migration on the
  still-empty partitions, not after backfill, because Drizzle does not model partitions and the filtered
  query test needs them. Incremental inserts into HNSW are acceptable at current volume; if the backfill
  proves slow, drop and rebuild the indexes after it. Queries filtering by court and year should set
  `hnsw.iterative_scan = relaxed_order` so a selective filter still returns a full top-k.
- Only `facts`, `issues`, `reasoning` and `decision` segments are embedded.
- `system.corpus.embed` stops at INR 500 per run (`CORPUS_EMBED_RUN_BUDGET_PAISE`) and 5,000 segments, and
  resumes on the next scheduled run. Spend is metered from the gateway's `costPaise`; no new table.
