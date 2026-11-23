# Advocate gold set (private)

The copilot quality gate (`pnpm --filter @causedeck/intelligence research-eval`, see
[docs/engineering/copilot-quality.md](../../docs/engineering/copilot-quality.md)) can also report on a
private, advocate-written gold set. It is never committed and never gates CI.

## Loading

Set `RESEARCH_EVAL_PRIVATE_DIR` to a directory holding the set:

```sh
RESEARCH_EVAL_PRIVATE_DIR=/path/to/gold-set pnpm --filter @causedeck/intelligence research-eval --out /tmp/research-eval
```

CI never sets this variable (`.github/workflows/research-eval.yml`).

## Layout

The same files and schemas as the synthetic set in this directory:

| File           | Required | Schema                                                                                                                                                               |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corpus.json`  | yes      | `{ judgments: [{ id, title, court, segments: [{ id, page, text }] }] }`, as `corpus.json` here                                                                       |
| `queries.json` | yes      | `{ queries: [{ id, text, facets?, judgments: { <judgmentId>: <grade 0-3> } }] }`, as `queries.json` here                                                             |
| `answers.json` | no       | scripted replies with the expected outcome per claim, as `answers.json` here (`id`, `queryId`, `task`, optional `sources`, `replies.claims`, one `expect` per claim) |

Without `answers.json` the answer metrics of the private set are reported as `n/a`. The private set has no
`manifest.json`, `baseline.json` or `thresholds.json`: nothing is pinned or compared.

## Reporting, never gating

The private set is reported in its own "Private set (not gated)" table of `report.md` and under `private`
in `report.json`. Its metrics never add a gate failure, whatever their value. Gating on it would need a
thresholds file in the private directory and a code change in `gateQuality`
(`packages/intelligence/src/research/eval/runner.ts`), reviewed as its own change.
