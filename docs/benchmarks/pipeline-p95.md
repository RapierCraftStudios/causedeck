# Pipeline p95 latency benchmark

Tracks #561. Budget: **p95 end to end under 20 s for a 1 minute voice note** (backlog E2-4, voice note capture and structuring).

The benchmark drives the capture path through the AI gateway, in this order:

1. `transcribe` (Sarvam, speech to text, India region)
2. `structure_hearing` (Bedrock, Claude, India inference profile)
3. matter match and proposal drafts (in process, no network)

It runs N iterations over five synthetic hearing notes (`packages/intelligence/src/bench/fixtures.ts`) and reports p50, p95 and p99 for the whole path and for each stage. Percentiles are nearest-rank over observed latencies. A warm-up iteration is run first and not counted.

## Run it

From the repo root:

```bash
# Mock providers (the default without credentials). Nothing leaves the process.
pnpm --filter @causedeck/intelligence bench:pipeline --provider mock --iterations 20 --out ./pipeline-p95-report
```

Flags: `--provider auto|mock|real` (default `auto`: real only when every variable below is set), `--iterations N`, `--warmup N`, `--audio-dir <dir>`, `--out <dir>`, `--budget-ms N` (default 20000). It writes `report.json` and `report.md` to `--out` and exits 1 on failure.

### Mock mode (CI)

Measures the harness and the gateway overhead, not the providers. The nightly `pipeline-p95-harness` job in `.github/workflows/perf.yml` runs it with `--provider mock --iterations 30` and checks that a complete report was produced. The only timing check is a sanity bound (no iteration over 10 s); the 20 s budget is **not** enforced on mocks.

### Real mode (manual, on staging)

Needs paid Bedrock and Sarvam calls (small volume), real keys from #112 and #113, and the staging host from #108. Run it there, not on a laptop, so network distance to the India region matches production.

Set these in the shell (values come from the staging `.env`; never paste them into an issue, PR or this file):

| Variable                       | Meaning                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `BEDROCK_REGION`               | India region, for example `ap-south-1`                   |
| `BEDROCK_ACCESS_KEY_ID`        | Bedrock IAM key id                                       |
| `BEDROCK_SECRET_ACCESS_KEY`    | Bedrock IAM secret                                       |
| `BEDROCK_MODEL_ID`             | Haiku-class India inference profile id                   |
| `SARVAM_API_KEY`               | Sarvam key                                               |
| `SARVAM_NO_TRAINING_CONFIRMED` | `true`, once the no-training contract term is confirmed  |

```bash
pnpm --filter @causedeck/intelligence bench:pipeline --provider real --iterations 30 \
  --audio-dir /path/to/synthetic-recordings --out ./pipeline-p95-report
```

`--provider real` fails fast and names any missing variable. In real mode the run exits 1 if p95 is not under the budget or if any iteration failed.

**Recordings.** Without `--audio-dir` the runner generates a 60 s tone, which a real speech-to-text returns little or nothing for (the structuring step then falls back to the fixture text, so its timing stays realistic, but the transcribe timing is not). For the real run, supply about five real synthetic 1 minute recordings (`.wav`, `.mp3`, `.m4a`, `.ogg` or `.webm`), in English, Tamil, Kannada and mixed speech as the product targets. They must be recordings made for this purpose, never customer audio. An optional `<file>.json` with `{"durationSeconds": 60}` states the length; the default is 60.

Use at least 30 iterations: with fewer than 20 the p95 is just the maximum.

## Results template

Copy into the "Results" section below, one entry per run.

```markdown
### YYYY-MM-DD, <host>, <commit sha>

- Providers: real (Bedrock model <id>, region <region>; Sarvam saarika)
- Recordings: <n> files, <languages>, <length> s each
- Iterations: <N> (warm-up 1), failures: <n>

| Stage           | p50 ms | p95 ms | p99 ms | max ms |
| --------------- | ------ | ------ | ------ | ------ |
| end to end      |        |        |        |        |
| transcribe      |        |        |        |        |
| structure       |        |        |        |        |
| match_and_draft |        |        |        |        |

Budget (p95 < 20000 ms): met / not met. Notes: <retries, throttling, slow stage>
```

## Where to record the real run

Post the filled template (not the keys, and no transcript text) as a comment on #561, and add the entry under Results here in the same PR that closes #561. If p95 is over budget, name the slowest stage in the comment and open a follow-up issue for it.

## Results

No real-provider run recorded yet (blocked on #112, #113 and the staging deploy #108).
