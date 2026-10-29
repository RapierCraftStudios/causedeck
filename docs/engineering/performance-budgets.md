# Performance budgets and load tests

Verification of the budgets in the technical spike (§3.2 Stage B triggers, §10 quality bars) and PRD §8 (#105). Everything lives under `e2e/perf/`; the budgets are defined once in `e2e/perf/thresholds.ts` and shared by k6, Lighthouse and the bundle check.

## Budgets

| Budget                                               | Limit                   | Enforced by                                          |
| ---------------------------------------------------- | ----------------------- | ---------------------------------------------------- |
| p95 server action                                    | under 300 ms            | k6 threshold, group `action`                         |
| p95 any read route                                   | under 400 ms            | k6 threshold, group `read`                           |
| Court-day board data from the cache path, p95        | under 300 ms            | k6 threshold, group `court_day_cache`                |
| Brief assembly per listing, p95                      | under 5 s               | k6 threshold, group `brief_assembly`                 |
| Error rate                                           | under 0.5%              | k6 `http_req_failed`                                 |
| Readiness flaps (a failed `/readyz` poll in the run) | none                    | k6 counter `readiness_flaps`                         |
| Cross-tenant requests under load                     | always 403 or 404       | k6 counter `cross_tenant_leaks`                      |
| Initial JS of `/w/[slug]/today`                      | at most 180 KB gzip     | `scripts/check-bundle-budget.ts` (with a diff report) |
| Lighthouse performance and accessibility             | at least 95             | `e2e/perf/lighthouse/lighthouserc.json`              |
| Cold start, 4 GB Android-class profile               | under 2.5 s (`interactive`) | the same config with `ANDROID_PROFILE_FLAGS`     |
| p95 regression against the previous nightly          | at most 15%             | `compare.ts`, opens an issue                         |

Lighthouse key pages: sign-in, today, brief sheet, obligations (signed in as the seeded owner) and the site's home, pricing and status. Two profiles run: mobile, and the throttled Android-class profile (4x CPU slowdown, slow 4G).

## Scenarios

`e2e/perf/k6/scenarios/` (k6 1.x runs TypeScript directly):

- `evening-prepare.ts`: the 18:00 to 23:00 IST peak (briefs, obligations, board, memory), compressed to minutes.
- `morning-court.ts`: the 07:00 to 10:30 IST peak (board, offline cache sync, hearings).
- `uploads.ts`: bursts of document uploads.
- `mixed-soak.ts`: 60 minutes of all of them plus a readiness poll every 5 s.

```sh
pnpm db:seed:demo && pnpm --filter @causedeck/e2e perf:seed 1000   # demo workspaces, then the 1,000-seat tenants
PERF_BASE_URL=http://localhost:3100 k6 run e2e/perf/k6/scenarios/evening-prepare.ts
pnpm --filter @causedeck/web build && pnpm --filter @causedeck/e2e perf:bundle
```

`perf:seed` adds fictional workspaces, users and seats around the demo seed (about 667 workspaces for 1,000 seats). Their matters are the demo workspaces' 40 each; the planned matter and listing counts are in the `planScale` output. Summaries are written to `e2e/perf/results/` (git-ignored).

## Safety

- **Allow-list.** Every scenario calls `guardTarget()` in `setup()` and `seed-scale.ts` checks the database host: only `localhost`, `127.0.0.1`, `[::1]` and the host in `PERF_STAGING_HOST` (which must contain `staging`) pass. Production never does.
- **Mocks, no egress.** Runs use `AI_PROVIDER=mock`, `BILLING_PROVIDER=mock`, Mailpit for email and MinIO for storage (`checkMockProviders`). The perf workflow runs `assertEgressBlocked` against a reserved `.invalid` host before the load starts and fails if it gets an answer.
- Test users are the fictional seeded ones; there are no production credentials.

## Reading results and the nightly run

`.github/workflows/perf.yml` runs nightly and on a PR labelled `perf`. k6 summaries, Lighthouse reports and the Stage B summary are stored as artifacts. The nightly compares each route group's p95 with the previous nightly's artifact (`compareP95`); a rise of more than 15% opens a GitHub issue with the table from `regressionReport`.

## Mapping to the Stage A to B trigger

Spike §3.2 moves to Stage B when **any** of these holds: p95 latency above 400 ms, DB CPU above 60%, or more than 1,000 seats. The soak samples DB CPU, connection count and queue lag every 10 s; `stageBSummary` takes the peak of each and lists which triggers are breached (`p95`, `db_cpu`, `seats`). A breach in one nightly is a warning; the same breach in three consecutive nightlies, or one on staging at real seat counts, is the evidence for the Stage B decision. **The decision is the founder's**, advised by the engineering lead, recorded as an ADR or an amendment to ADR 0053 (the scale path); the runbooks for the move are in `infra/runbooks`.

## Known gaps

The scaled seed multiplies tenants and seats, not matters: the extra workspaces have no matters or listings of their own, so the DB-side numbers understate a real 1,000-seat dataset until the demo seed can generate workspaces beyond the two fixed ones (tracked as a follow-up).
