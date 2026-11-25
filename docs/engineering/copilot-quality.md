# Copilot quality gate

The `research-eval` CI check (`.github/workflows/research-eval.yml`, #891, #1119, ADR 0051 §Evaluation)
measures retrieval and answer grounding on a pinned synthetic set and fails a pull request when either
regresses. It runs `pnpm --filter @causedeck/intelligence research-eval` (`packages/intelligence/src/research/eval/cli.ts`).
It uses no network, no provider and no database: the hybrid ranker runs on the mock embedder and reranker
from `@causedeck/ai`, and the answer verifiers get scripted model replies. Two runs give the same report.

This gate adds no `@causedeck/core` runtime export, table, job, flag, i18n namespace or server action, so
no cross-tenant, flag or i18n registry changes with it.

## Fixtures

`fixtures/research-eval/`:

| File | What |
|---|---|
| `corpus.json` | Synthetic judgments and their segments (page and text). |
| `queries.json` | Queries with graded relevant judgments (0-3). |
| `answers.json` | Scripted replies of `answer_research_query` (`/research`, `answerQuery`) and `answer_matter_question` (the matter copilot, `answerMatterQuestion`), with one expected outcome per claim: `verified`, optional `reason` (`unknown_source` or `quote_not_found`) and optional computed `pinpoint` (`page`, `paragraph`). Good claims sit next to adversarial ones: altered quotes, altered numbers, foreign or unknown source ids, empty quotes and wrong model-claimed pinpoints. A copilot reply may also carry an optional written `answer` with `[n]` markers (#1167) and, from `answer_matter_question.v3` (#1192), an optional one-sentence `bottomLine` that leads with the answer ("Yes, if…"). The bottom line is held to D-004 like a claim: the verifier keeps it only when at least one of its markers points at a verified claim (renumbered like the answer), else it is dropped. The gate scores the claims only; a reply without `answer` or `bottomLine` still parses. |
| `manifest.json` | sha256 of `corpus.json`, `queries.json` and `answers.json`. A drifted file fails the run. |
| `baseline.json` | The committed value of every gated metric. |
| `thresholds.json` | Per-metric tolerance and direction (`higher-is-better` or `lower-is-better`). |
| `GOLD-SET.md` | The layout of the private advocate gold set. |

## Metrics

Retrieval, per set (the queries of `queries.json`):

- **recall@50**: mean over queries of the relevant judgments (grade ≥ 1) in the top 50, divided by all relevant judgments.
- **nDCG@10 (BM25)**: mean normalised discounted cumulative gain of the top 10 of the BM25 baseline ranker, with the graded relevance.
- **nDCG@10 (hybrid)**: the same for the hybrid ranker (BM25 plus embeddings, reranked) on the mock providers.

Answers, per set (the cases of `answers.json`). Each case runs the real verifier with a resolver that returns the scripted reply. The verifier, never the reply, decides whether a claim is verified and computes its pinpoint from the stored text (D-004).

- **citation accuracy**: verified claims whose cited id exists in the case's corpus or sources and belongs to the judgment, document or source the answer reports, divided by verified claims (1 when none).
- **quote-verification rate**: claims expected verified that came back verified, divided by claims expected verified.
- **pinpoint accuracy**: verified claims with an expected pinpoint whose computed page and paragraph equal it, divided by such claims. A pinpoint in the model reply is ignored.
- **false-verified**: the count of claims expected unsupported that came back verified.

Every disagreement with an expectation is listed under "Answer mismatches" in the report.

## Gate

`compareQuality` compares each synthetic metric with `baseline.json`. A metric regresses when it moves in
its worse direction by more than its tolerance in `thresholds.json` (nDCG@10 BM25 and hybrid: 0.02, the
2-point gate of ADR 0051; recall@50 and the answer rates: 0). Each regression fails the job with a message
naming the metric. A change within tolerance passes.

**false-verified is absolute.** Any claim shown as verified that the verifier should have rejected (an
altered quote, a foreign segment id) fails the run whatever `thresholds.json` says. D-004 allows zero
unverified statements shown as verified; a tolerance would let one through. A mutation test
(`answer-eval.mutation.test.ts`) removes the quote check from `answerQuery` and asserts that the gate then
fails on false-verified.

The report goes to stdout, to the run's step summary (`$GITHUB_STEP_SUMMARY`), and to `report.md` and
`report.json` (`schemaVersion` first) in the `research-eval-report` artifact.

## Updating the baseline

Update it only in a reviewed change that explains why the numbers moved (a better ranker, a new or
corrected case), never to hide a regression:

```sh
pnpm --filter @causedeck/intelligence research-eval --update-baseline --out /tmp/research-eval
```

This rewrites `baseline.json` (all metrics) and `manifest.json` together; commit both. `falseVerified`
must stay 0 in the baseline. Changing a tolerance in `thresholds.json` is its own reviewed change.

## Private gold set

`RESEARCH_EVAL_PRIVATE_DIR` points the run at an advocate-written gold set (layout in
`fixtures/research-eval/GOLD-SET.md`). It is private because advocates write it from real judgments and
matters: the source texts carry licence terms, and the questions and answers can carry client-confidential
detail. It is reported in its own table and never gates: CI never sets the variable, and its metrics never
add a failure. Gating on it would need a thresholds file there and a code change, reviewed on its own.
