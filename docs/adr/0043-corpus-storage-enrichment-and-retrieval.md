# 0043. Corpus storage, enrichment and retrieval

## Status

Proposed

## Date

2026-10-27

## Context

D-048 amended D-001: CauseDeck keeps a corpus of raw judgments and orders. #484 built the first slice. `judgment` (`packages/db/src/schema/corpus.ts`) is a global table holding:

- the court, neutral citation, bench and date;
- the per-page text layer (`page_text` jsonb) and the sha256 dedupe key;
- provenance;
- one whole-document `embedding` with an HNSW index, which stays null until "an ADR picks the model".

On top of that slice:

- `verifyCitation` resolves neutral citations to rows.
- The #497 matcher (`packages/intelligence/src/corpus/match.ts`) alerts matters by statute and section. Its semantic step is unimplemented for the same reason.

The research product needs more than lookup. A lawyer asks "medical negligence cases where a post-operative infection followed surgery without informed consent", or "bail under s.37 NDPS with a commercial quantity and delay in trial". The answer is a ranked set of judgments with the paragraphs that match and verified quotes.

Four things in the #484 design make that impossible:

1. **One vector per judgment.** The facts of a 40-page judgment are averaged away. Fact-pattern retrieval needs passage-level vectors.
2. **No lexical index on the corpus.** Advocates search by section ("304A", "s.35 CPA") and by terms of art ("res ipsa loquitur", "Bolam"). Vectors are weak at exact tokens. ADR 0025 gave full-text search to the lawyer's own documents only.
3. **No facets.** "Consumer fora, after 2019, Supreme Court and Madras HC" needs structured fields: subject area, statutes cited, cases cited, court level, outcome.
4. **No scale plan for the corpus.** ADR 0003's stage triggers are seat-based. The corpus grows with ingestion, not seats. The two open datasets alone (Supreme Court 1950–2025 and 25 High Courts, CC-BY-4.0, Dattam Labs on AWS Open Data) are millions of judgments and about 1 TB of PDFs [INFERENCE, to verify on import].

D-053 adds two inputs to this:

- Party details in the shared corpus are replaced with role placeholders.
- The "no editorial fields" rule (#484's static test) narrows to "no content from an editorial source". Our own machine-generated tags and segment roles are allowed. _EBC v. D.B. Modak_ protects SCC's editorial additions, not original analysis of the raw text.

Research: [docs/strategy/13](../strategy/13-legal-data-competitive-research.md).

## Decision drivers

- Fact-pattern queries return the right judgments in the top 10, measured on a fixed evaluation set rather than by feel.
- Every quote and citation shown resolves to stored text (D-004). The model never writes a citation string.
- The shared corpus carries no party identities (D-053). Name search over judgments is impossible by construction.
- Keep one datastore (ADR 0003) for as long as it holds. Plan the step out before it is needed.
- Cost: storage and vectors grow with the corpus, so every byte in the hot tier must earn its place.

## Considered options

| Option                                                                                                                                                                                   | Verdict          | Reason                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres: segment table, `halfvec` + HNSW, `tsvector` + GIN, facet tables, RRF fusion, reranker through the AI gateway; pgvectorscale and a dedicated corpus instance as the scale steps | Chosen           | One datastore and backup story; global tables need no RLS; pgvector 0.8 iterative scans handle filtered vector search; clear triggers for each scale step |
| A separate search engine now (OpenSearch, Qdrant, Vespa)                                                                                                                                 | Rejected for now | A second datastore to secure, back up and keep in India; Postgres is enough until the triggers below                                                      |
| Keep one vector per judgment                                                                                                                                                             | Rejected         | Fact patterns are lost in whole-document averages                                                                                                         |
| Vectors only (no lexical index)                                                                                                                                                          | Rejected         | Section numbers and terms of art need exact matching                                                                                                      |
| Store the corpus with party names and filter at query time                                                                                                                               | Rejected         | Name search stays possible, and right-to-be-forgotten orders bind the stored data (D-053)                                                                 |
| A fine-tuned legal LLM for retrieval or answers                                                                                                                                          | Rejected         | No independently evaluated Indian legal LLM exists; retrieval plus a general model through the gateway (ADR 0007) is cheaper and auditable                |

## Decision

### Storage tiers

| Tier | Holds                                                              | Where and how                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold | Original PDFs                                                      | Object storage (ADR 0006), keyed by sha256 (`judgment.blob_key`). Lifecycle moves objects to the infrequent-access class after 90 days. PDFs are already compressed, so no recompression. |
| Warm | Raw page text (`judgment.page_text`) and the redacted segment text | Postgres. Large `text` and `jsonb` columns use `lz4` TOAST compression (`ALTER TABLE … ALTER COLUMN … SET COMPRESSION lz4`, set in the migration that creates or alters them).            |
| Hot  | Segment vectors, lexical vectors, facet rows                       | Postgres indexes. This tier is sized and budgeted below.                                                                                                                                  |

### Segments: the unit of retrieval

- New global table `judgment_segment`:
  - `id`, `judgment_id` (fk), `ordinal`;
  - `role`: one of `header`, `facts`, `issues`, `arguments`, `reasoning`, `decision`, `other`;
  - `page_from`, `page_to`;
  - `text` (redacted, see D-053), `search_tsv` and `embedding`;
  - denormalised `court`, `court_level` and `judgment_year` for filtering and partitioning.
- Segmentation runs at ingest:
  1. Split into paragraphs, using the court's numbered paragraphs where present.
  2. Assign a rhetorical role with a classifier. Start with OpenNyAI-style labels, through the AI gateway for low-confidence cases.
  3. Pack consecutive paragraphs of one role into segments of roughly 300–600 tokens, never crossing a role boundary.
- Each segment keeps page anchors, so a quote resolves to a page of the court PDF.
- `judgment_segment` is range-partitioned by `judgment_year` in decades (hand-written SQL in the migration, because drizzle does not model partitions). Old decades are effectively read-only, so they vacuum and back up cheaply and can move to a cheaper tablespace later.
- `judgment.embedding` is no longer used for retrieval. It stays nullable until a contract migration drops it. #497's semantic step uses segments.

### Enrichment, all generated from the raw official text at ingest

All facet tables are global.

- **`judgment_statute_ref`** (judgment, normalised statute, section, page).
  - Extends the #497 section parser.
  - Adds the offence-date-aware IPC↔BNS, CrPC↔BNSS and IEA↔BSA mapping, so a search for BNS 106 also finds IPC 304A precedents and the reverse.
- **`judgment_citation_ref`** (judgment, raw citation, normalised citation, `cited_judgment_id` when resolved, page). This is the citation graph. Cited-by counts feed ranking as a factual signal. No "good law" or treatment label is shown until a treatment feature exists with human validation.
- **`judgment_tag`** (judgment, subject area from a controlled vocabulary in `packages/intelligence`, confidence, model version).
- **Outcome on `judgment`**: `allowed`, `dismissed`, `partly_allowed`, `disposed`, `remanded` or `unknown`. Extracted from the decision segment with anchors (ADR 0028 style).
- **Header fields on `judgment`**: `court_level` and `case_title` (as published, or masked per D-053).
- Every generated field records its model or ruleset version. Re-enrichment is a job, never a manual edit.
- No field may hold text taken from an editorial source (SCC Online, Manupatra or others). The #484 static test changes from banning column names to asserting that every corpus source in the registry is an official or open source.

### Anonymised text (D-053)

- `judgment_segment.text` is the redacted text. Every user-facing read uses it: search, research answers, snippets and the developer API.
- `judgment.page_text` (raw) is read only by citation verification internals and staff tooling. A static test fails if any module under the research, search or API paths selects `page_text`.
- Quotes shown to users are matched against redacted segment text. "Open the court's PDF" links to the official source for the original.
- Redaction is a versioned pipeline. Bumping the version re-redacts from `page_text`. The placeholder mapping is not stored.

### Lexical search

- `judgment_segment.search_tsv` is generated as `setweight(to_tsvector('english', text), 'A') || to_tsvector('simple', text)`, with a GIN index. `english` stems, and `simple` keeps section numbers and Indic words whole.
- The query side runs `websearch_to_tsquery`, plus exact statute and section matches through `judgment_statute_ref`.
- ParadeDB `pg_search` (BM25) is the upgrade if the evaluation shows `ts_rank` losing. It is AGPL, so a licence review comes first.

### Vectors

- Only `facts`, `issues`, `reasoning` and `decision` segments are embedded. Headers and procedural text are not, which roughly halves the vector count.
- Column type `halfvec(CORPUS_EMBEDDING_DIMENSIONS)`, exported from `@causedeck/db/vector` next to `EMBEDDING_DIMENSIONS`. It has an HNSW index (`halfvec_cosine_ops`, m=16, ef_construction=64) per partition.
- Queries set `hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8) so filtered searches still fill the top-k.
- The model is chosen by the evaluation set (below) among bge-m3 (self-hosted, multilingual, 1024 dimensions), Cohere Embed Multilingual on Bedrock and Titan Text Embeddings v2 (1024/512/256). Default to the cheapest model within 2 nDCG@10 points of the best. If the chosen model supports Matryoshka truncation, store 512 dimensions unless the evaluation shows a loss.
- All embedding calls go through the AI gateway (ADR 0007, ADR 0022): India-only mode, no training, cost metered.

### Query pipeline (`packages/intelligence/src/research/`)

1. **Plan.** The gateway model turns the question into a structured plan:
   - facets: subject areas, statutes and sections (expanded through the IPC↔BNS mapping), courts, court levels, date range and outcome;
   - a fact description for vector search;
   - keywords for lexical search.

   The plan is schema-validated and shown to the lawyer as editable filters.

2. **Retrieve.** One SQL round trip per arm, both filtered by facets:
   - lexical top 200 over `search_tsv`;
   - vector top 200 over `embedding`.
3. **Fuse** with reciprocal rank fusion (k = 60). Boost slightly for court level and log(1 + cited-by). The weights are tuned on the evaluation set.
4. **Rerank** the top 100 segments with a cross-encoder reranker through the gateway: Cohere Rerank on Bedrock, or a self-hosted bge-reranker.
5. **Group** by judgment and keep the best three segments each. Return the top 20 judgments.
6. **Answer** (optional, on request).
   - The model receives segment ids and redacted text only, and returns claims that reference segment ids. Rendered citations come from the database.
   - Each quote is verified by exact or normalised match against the segment text. A failed quote is dropped and the claim is marked unsupported.
   - "No matching authority found" is a valid answer.
   - The retrieval set and plan are kept in the AI audit log (ADR 0022).

### Budget and scale steps

Sizing assumption: 2 M judgments × ~10 embedded segments × 1024 `halfvec` (2 KB) ≈ 40 GB of vectors plus about 1.5× for HNSW. This fits a dedicated corpus database on one large instance. At 15 M judgments it does not fit.

| Trigger                                                                                                  | Step                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus tables > 100 GB, or search load raises tenant p95 above ADR 0003's 400 ms                         | Move the corpus schema to a dedicated Postgres instance (`CORPUS_DATABASE_URL`). Tenant tables reference `judgment` only by id, so the `judgment_alert` foreign key becomes an id column with a reconciliation job. |
| HNSW indexes exceed the instance's RAM, or > 30 M vectors                                                | pgvectorscale StreamingDiskANN with its compressed in-memory representation (PostgreSQL licence) on the corpus instance. Alternatively, binary-quantised first pass plus a `halfvec` rerank.                        |
| Evaluation shows Postgres lexical ranking is the bottleneck, or queries > 1 s p95 at the corpus instance | pg_search after licence review; OpenSearch only through a new ADR.                                                                                                                                                  |

Cost reference [INFERENCE on published rates, to confirm in the console]: embedding 2 M judgments (about 20 B tokens, half of which are embedded) costs roughly ₹20k–1 lakh once, depending on the model. Storage dominates afterwards.

### Evaluation (gates every choice above)

- A fixed set of at least 50 fact-pattern and statute queries written by advocates. Each has judged relevant judgments from the imported corpus.
- Metrics: nDCG@10 and recall@50 for retrieval, and citation-and-quote faithfulness for answers.
- It runs in CI on a pinned corpus sample. Regressions beyond 2 nDCG points fail the research package's eval job.

## Consequences

- Positive: fact-pattern search, statute search and filters run on one store, with page-anchored verified quotes.
- Positive: the shared corpus has no party identities, so name search, right-to-be-forgotten exposure and DPDP scope shrink by design.
- Positive: each scale step has a measurable trigger and no rewrite.
- Negative: ingest becomes a multi-stage pipeline (redact, segment, enrich, embed) with versioned re-runs. Data ops (#514) must show its backlog and cost.
- Negative: redacted text can lose meaning where names carry it, for example company names that match a person's name. The redaction evaluation tracks this.
- Negative: partitioned tables and hand-written partition SQL sit outside drizzle's model. Migrations need review.

## Revisit when

- Any trigger in the scale table fires.
- The evaluation shows hybrid retrieval below 0.6 nDCG@10 after tuning (consider a different architecture or a licensed corpus).
- Counsel or a court order requires changes to what the redacted layer keeps.
- A licensed editorial corpus becomes available (D-001 revisit). It would sit in separate tables with its own licence rules.

## Links

- [ADR 0003](0003-postgres-17-pgvector-drizzle-rls-multitenancy.md), [ADR 0006](0006-s3-abstraction-minio-to-s3-and-envelope-encryption.md), [ADR 0007](0007-ai-gateway-india-only-mode-no-training-no-tools.md), [ADR 0022](0022-ai-gateway-implementation.md), [ADR 0025](0025-document-pipeline.md), [ADR 0028](0028-anchored-extraction.md)
- [DECISIONS.md](../../DECISIONS.md) D-001, D-004, D-048, D-053
- [Research: legal data layer](../strategy/13-legal-data-competitive-research.md)
- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
