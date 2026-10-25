# Court-day freeze and deploys

Production deploys stop during court hours so a release never lands while users are in a hearing.

## Windows (Asia/Kolkata, start inclusive, end exclusive)

| Window          | Frozen            |
| --------------- | ----------------- |
| morning-court   | 07:00:00-10:29:59 |
| evening-prepare | 18:00:00-22:59:59 |

Every other time is open, every day of the week. The clock is the runner's, never an input
(`.github/actions/freeze-guard/freeze.ts`). Staging is not frozen; it records the same check.

## Normal path

1. Merge to `staging`: `deploy-staging.yml` builds, signs, deploys and smokes it.
2. Within 24 h, run `deploy-prod.yml` (or push a `v*` tag) with the same full sha.
3. Job 1 is the freeze guard. Inside a window it fails and names the next open window; nothing else
   runs and SSH is never reached. Re-run after the window.
4. `promote` requires a successful staging deployment of the same sha in the last 24 h.
5. `deploy` waits for `production` environment reviewers, re-checks the freeze, then: pull images,
   expand-only migrations as the owner role, roll `api` and `worker`, then `web` and `admin` one
   container at a time, each gated on `/readyz` for 60 s.
6. A failed gate rolls back to the previous release automatically; the failure summary is in the job
   summary and the GitHub deployment is marked `failure`. If the summary says the rollback failed,
   intervene on the host (`infra/scripts/rollback.sh <sha>`).

Each deploy writes `release.json` (sha, IST time, deployer, migrations) under
`/opt/causedeck/releases/<sha>/` and a GitHub deployment record; `/readyz` reports the running sha.

Migrations in a deploy must be expand-only. `DROP COLUMN`, `DROP TABLE` and `SET NOT NULL` are
rejected unless the file carries a `-- contract` tag, which belongs in the release after the expand
release has been live.

## Planning

PRs labelled `deploy:prod` get a warning comment from `freeze-warning.yml` when a freeze is active or
starts within two hours. Plan merges for open windows.

## Override etiquette (P0 only)

Use `hotfix-prod.yml` only for an active P0 that cannot wait for the next open window.

- Open an incident issue first; the workflow comments the audit trail on it.
- Give a real reason (what is broken, who is affected); an empty reason is rejected.
- It needs two approvals: the `hotfix` environment and the `production` environment.
- The sha must still be green on staging. Do not skip staging.
- Prefer a revert of the last release (`rollback.sh`) over a forward fix when that restores service.
- Every use posts a Slack-compatible message to the `SLACK_WEBHOOK_URL` of the `hotfix` environment.
- Review each override in the next incident review.

## Communications

- Planned deploy blocked by the freeze: say nothing to users; post the next open window in the
  release thread.
- Hotfix during court hours: post in the status channel before the deploy ("fixing X, deploying at
  HH:MM IST, expect no downtime"), and again once `/readyz` reports the new sha. Rolling deploys keep
  at least one web container ready, so no maintenance banner is needed unless the incident is.
- Failed deploy with rollback: post that the release was rolled back and which sha is live.
- Rollback failed: declare an incident and notify users through the status page.

## Hot-deployable changes during freeze

Only changes designed to be hot-deployable go out during a freeze, and they do not use this
pipeline: adapters and feature flags change through their own safe paths (flag toggles in the admin
console, adapter configuration through its audited settings). Anything that needs a new image is a
deploy and is frozen like any other.
