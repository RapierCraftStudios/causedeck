**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield feature; part 3 of 5 of #480; nothing polls or matches notices yet)
**Task Type**: feature

### What Was Claimed
Part 3 of #480: a `packages/core/src/notices` domain (poll through the fetch layer, persist notices with provenance, dedupe, match to workspaces by forums used and to matters), a scheduled `notices.poll` pg-boss job per cleared source honouring registry rate limits, uncleared sources never polled (log "skipped: not cleared"), plus "Add @causedeck/fetch to core dependencies with reason", CORE_DOMAIN_DEPENDENCIES + core-domains.md, cross-tenant registry/services test, worker registry.test.ts and schedules.test.ts.

### What We Found
- No `packages/core/src/notices` exists on base; no notices job in `packages/core/src/jobs/registry.ts:181-182` (only corpusPoll, causelistPoll).
- Schema from #584 is present: `packages/db/src/schema/notices.ts:50-80` (`notice`, unique `(source_id,url)` at :71 gives idempotent re-polls; document columns nullable) and `:84-118` (`notice_match`, tenant RLS, unique per matter / per forum). Migration `0071_notices.sql` seeds 8 uncleared `kind='notice'` sources (`in.tn.madras-hc.notices`, `in.ka.karnataka-hc.notices`, ...). Latest migration on base is 0073.
- Parsers from #585 are exported from `packages/intelligence/src/notices/index.ts:4-28`: only Madras HC (`parse-madras-hc.ts:5`) and Karnataka HC (`parse-karnataka-hc.ts`) have parsers; `ParsedNotice` (`types.ts:9-22`) carries `kindHint` (nullable) and `forumCodes`. `tagNotice` (`tag.ts`) is the optional AI tagger.
- **`@causedeck/fetch` is already in `packages/core/package.json:48`** (added by #591/#585 merges). The issue's "add @causedeck/fetch to core dependencies" is therefore already done. Core still must not *import* it: lint rule restricts it (`packages/config/test/eslint-rules.test.ts:35`), `fetch-log.ts:9` and `court/list-watch.ts:180` take a structural fetcher, and `jobs/definitions/causelist-poll.ts:8-9,22-26` has the worker wire it (`apps/worker/src/main.ts:29-39`). Prior decision (#591/PR #612): do not touch core package.json for fetch, use a structural dependency.
- Cross-workspace reads by a `system.*` job go through an owner-defined SECURITY DEFINER function, e.g. `app_cause_list_watch_targets` (`migrations/0068_cause_list_watch.sql`), because tenant tables are FORCE RLS. Matching needs "which workspaces/matters use forum X": `proceeding.forum_id` (`packages/db/src/schema/proceedings.ts:46`) -> matter; no such function exists yet.
- Job pattern to copy: `jobs/definitions/corpus-poll.ts` (iterates `source` rows, `policyFor` throws `SourceNotCleared` -> skip, :73-85) and `causelist-poll.ts` (cron, `system.*`, singleton, fetcher factory). Rate limit per source is enforced inside the fetch layer from `source.rate_limit_per_minute` (`source-registry.ts:58`); the job only needs to fetch one page per source per run.
- Registries to touch: `apps/worker/src/__tests__/registry.test.ts:154-155`, `schedules.test.ts:33-34,86`, `packages/config/eslint/core-domains.js` (`'case-watch'` at :28 is the model) and `docs/engineering/core-domains.md:22-25`, `packages/db/src/testing/cross-tenant-registry.ts` (`NOT_A_SERVICE` ~:899-913, `SERVICE_TESTS` :181; `notice_match` already at :139).

### Root Cause
Greenfield: parts 1-2 landed the storage and parsers; the poll, persistence and matching service and job were the remaining piece.

### Affected Files
- `packages/core/src/notices/{index,poll,match}.ts` (+ tests) new domain
- `packages/core/src/jobs/definitions/notices-poll.ts` new; `jobs/registry.ts`, `jobs/index.ts`
- `packages/core/src/index.ts`, `packages/core/package.json` (`./notices` export only, mirroring `./case-watch` at :21; no dependency change)
- `packages/db/migrations/00NN_notice_match_targets.sql` + `meta` snapshot/journal (owner-defined matching function) and any db test lists that enumerate functions
- `apps/worker/src/main.ts` (wire fetcher), `apps/worker/src/__tests__/registry.test.ts`, `schedules.test.ts`
- `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`

### Sibling Sweep
Same pattern already used by `pollCauseList` (#482), `runCaseStatusLookup` (#591) and `system.corpus.poll` (#484); follow them. Alerts (#587) and UI (#588) are out of scope: this change must not touch `packages/notifications` or `apps/web`. Sources without a parser (SC, district, bar councils, eGazette) are skipped with a log, not failed.

### History
`notice` schema/seed: #584 (0071). Parsers: #585 (PR #611). Fetch-layer-through-structural-port pattern: #482/PR #596 and #591/PR #612. No prior attempt at #586.

### Recommendation
Implement as a `notices` core domain with a structural `NoticeFetcher` port (not importing `@causedeck/fetch`), `pollNotices` that for each `kind='notice'` source calls `policyFor` (catch `SourceNotCleared` -> log `skipped: not cleared`, no fetch), fetches the policy base URL, parses with the matching parser (no parser -> log skipped), upserts `notice` on `(source_id,url)` with provenance (`source_type='adapter'`, `source_ref`=url, kind = `kindHint ?? 'other'`, document columns null), then matches new notices through a new owner-defined function returning (workspace_id, matter_id, forum_id) for forum codes, inserting `notice_match` rows per workspace inside `withWorkspace` (`ON CONFLICT DO NOTHING`; `forum` reason once per workspace, `matter_forum` per matter). Job `system.notices.poll`, hourly cron, singleton, worker wires the fetcher like causelist. Register in all guard lists.

### Related Issues
#480 (parent), #584, #585 (done), #587 (alerts, consumes `notice_match`), #588 (UI), #482, #591, #484.
