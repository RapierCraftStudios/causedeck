**Verdict**: ALREADY-FIXED
**Confidence**: high
**Severity**: medium (part 3 of 5 of #480)
**Task Type**: feature

### What Was Claimed
Part 3 of #480: a `packages/core/src/notices` domain (poll via the fetch layer, persist notices with provenance, dedupe, match to workspaces and matters), an hourly `notices.poll` job over cleared sources, uncleared sources logged "skipped: not cleared" and never fetched, plus registry/guard-list updates.

### What We Found
- `packages/core/src/notices/{index,poll,match}.ts` and `notices.test.ts` are tracked on HEAD (f0fb0e86), committed under #586 (522be10b, 580e2fbc, 945b5222).
- `packages/core/src/notices/poll.ts:101` logs `skipped: not cleared`; `notices.test.ts:91,184` assert it and that no fetch happens.
- Job `system.notices.poll`: `packages/core/src/jobs/definitions/notices-poll.ts`, registered at `packages/core/src/jobs/registry.ts:193`, exported at `jobs/index.ts:129`.
- Worker wiring: `apps/worker/src/main.ts:52` (`setNoticeFetcherFactory(governedFetcher)`); `registry.test.ts:160`, `schedules.test.ts:39,102` list the job (hourly cron).
- Matching function migration `packages/db/migrations/0077_notice_match_targets.sql`.
- Guard lists: `packages/config/eslint/core-domains.js:33`, `docs/engineering/core-domains.md:26,187`, `packages/db/src/testing/cross-tenant-registry.ts:934-939`, `packages/core/src/__tests__/cross-tenant/services.test.ts:427` (matchNotices case).
- `@causedeck/fetch` already in `packages/core/package.json`; core takes a structural fetcher, as the lint rule requires.
- `./notices` export at `packages/core/package.json:23`, `packages/core/src/index.ts:8`.

### Root Cause
No defect remains: the work was merged to the base before this lane started.

### Affected Files
None to change.

### Sibling Sweep
Not applicable; follows the `pollCauseList` / `runCaseStatusLookup` pattern.

### History
Landed under #586 (commits above), merged through the milestone; #618 is the current base tip.

### Recommendation
Close #619 as already fixed; no code change.

### Related Issues
#480, #584, #585, #586, #587, #588.
