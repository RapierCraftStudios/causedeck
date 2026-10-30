#!/usr/bin/env bash
# Deploy one release to this host (#100): pull images, expand-only migrations as the owner role,
# roll api and worker, then web (and admin) one container at a time behind a 60 s /readyz gate, with
# automatic rollback to the previous release on any failure. Run by deploy-staging/deploy-prod.yml
# over SSH from the release bundle (infra/ and packages/db/migrations/) extracted on the host.
#
#   CAUSEDECK_ENV_FILE=/etc/causedeck/prod.env DEPLOYER=octocat infra/scripts/deploy.sh <gitsha>
#
# Exit: 0 deployed; 1 failed and rolled back (or nothing to roll back); 2 failed and rollback failed.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/scripts/rollback.sh
. "$SELF_DIR/rollback.sh"

SHA="${1:?usage: deploy.sh <gitsha>}"
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || { echo "deploy: bad sha" >&2; exit 1; }
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT/packages/db/migrations}"
DEPLOYER="$(printf '%s' "${DEPLOYER:-${USER:-unknown}}" | tr -c 'A-Za-z0-9._@-' '_')"
REL="$RELEASES_DIR/$SHA"
mkdir -p "$REL"

PREVIOUS=""
if [ -L "$RELEASES_DIR/current" ]; then PREVIOUS="$(basename "$(readlink -f "$RELEASES_DIR/current")")"; fi
[ "$PREVIOUS" != "$SHA" ] || PREVIOUS="$(sed -n 's/.*"previous_sha": *"\([0-9a-f]*\)".*/\1/p' "$REL/release.json" 2>/dev/null || true)"

migration_list() {
  local f first=1
  printf '['
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$f" ] || continue
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '"%s"' "$(basename "$f")"
  done
  printf ']'
}

# write_release <status>: release.json (sha, IST time, deployer, migrations) beside the release env.
write_release() {
  local status="$1"
  printf '{"sha":"%s","previous_sha":"%s","time_ist":"%s","deployer":"%s","status":"%s","migrations":%s}\n' \
    "$SHA" "$PREVIOUS" "$(ist_now)" "$DEPLOYER" "$status" "$(migration_list)" >"$REL/release.json"
}

fail_summary() {
  local reason="$1" outcome="$2"
  {
    echo "### Deploy of \`$SHA\` failed"
    echo "- Reason: $reason"
    echo "- Outcome: $outcome"
    echo "- Previous release: ${PREVIOUS:-none}"
    echo "- Time: $(ist_now)"
  } | tee "$REL/failure-summary.md"
}

make_release_env "$SHA" >/dev/null

log "pulling images for $SHA"
compose "$SHA" pull --quiet api worker web admin

log "checking migrations are expand-only"
check_args=(--dir "$MIGRATIONS_DIR")
[ -z "$PREVIOUS" ] || [ ! -f "$RELEASES_DIR/$PREVIOUS/release.json" ] || check_args+=(--applied "$RELEASES_DIR/$PREVIOUS/release.json")
if command -v node >/dev/null 2>&1; then
  node "$SELF_DIR/check-migrations.mjs" "${check_args[@]}" || { fail_summary "migration is not expand-only" "nothing changed"; exit 1; }
fi

log "running migrations as causedeck_owner"
if [ -n "$(compose "$SHA" ps -q postgres)" ]; then
  # Postgres runs on its own image tag; --no-deps keeps compose from recreating it for the new sha.
  compose "$SHA" --profile migrate run --rm --no-deps migrate \
    || { fail_summary "migration failed" "nothing rolled; migrations are expand-only"; exit 1; }
else
  CAUSEDECK_ENV_FILE="$REL/release.env" GIT_SHA="$SHA" bash "$SELF_DIR/migrate.sh" \
    || { fail_summary "first-run bootstrap and migration failed" "nothing rolled"; exit 1; }
fi

if ! roll_stack "$SHA"; then
  log "rollout failed"
  if [ -z "$PREVIOUS" ]; then
    write_release failed
    fail_summary "readiness gate failed" "no previous release to restore"
    exit 1
  fi
  if rollback_to "$PREVIOUS"; then
    write_release rolled-back
    fail_summary "readiness gate failed" "rolled back to \`$PREVIOUS\`"
    exit 1
  fi
  write_release rollback-failed
  fail_summary "readiness gate failed" "ROLLBACK ALSO FAILED: intervene on the host"
  exit 2
fi

write_release deployed
ln -sfn "$REL" "$RELEASES_DIR/current"
log "deployed $SHA at $(ist_now) (previous: ${PREVIOUS:-none})"
