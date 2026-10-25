#!/usr/bin/env bash
# Rolling replacement and rollback for the production stack (#100). deploy.sh sources this file for
# the shared functions; run directly it restores the previous release (or the sha given):
#
#   CAUSEDECK_ENV_FILE=/etc/causedeck/prod.env infra/scripts/rollback.sh [sha]
#
# Releases live in $RELEASES_DIR/<sha>/ (release.json, release.env); `current` points at the live
# one. Image tags are sha-<gitsha>, so "previous tags" is the previous sha. Migrations are expand-only
# (check-migrations.mjs), so rolling code back never needs a database rollback.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/docker/compose.prod.yml}"
RELEASES_DIR="${RELEASES_DIR:-/opt/causedeck/releases}"
GATE_SECONDS="${GATE_SECONDS:-60}"
# Roll order: api and worker first, then web, then admin. service:port:path of the readiness probe.
ROLL_ORDER=(api worker web admin)
declare -A PROBE=([api]="3001 /readyz" [worker]="3003 /readyz" [web]="3000 /readyz" [admin]="3200 /healthz")

log() { echo "deploy: $*"; }

# Per-release env file: the base env file with GIT_SHA set, so containers report the running sha.
make_release_env() {
  local sha="$1" file="$RELEASES_DIR/$1/release.env"
  : "${CAUSEDECK_ENV_FILE:?set CAUSEDECK_ENV_FILE}"
  mkdir -p "$RELEASES_DIR/$sha"
  (umask 077; { grep -v '^GIT_SHA=' "$CAUSEDECK_ENV_FILE" || true; echo "GIT_SHA=$sha"; } >"$file")
  echo "$file"
}

# compose <sha> args...: the stack at <sha>, env passed for interpolation and for the containers.
compose() {
  local sha="$1"; shift
  local env_file="$RELEASES_DIR/$sha/release.env"
  GIT_SHA="$sha" CAUSEDECK_ENV_FILE="$env_file" \
    docker compose -f "$COMPOSE_FILE" --env-file "$env_file" "$@"
}

container_sha() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed -n 's/^GIT_SHA=//p' | head -n 1
}

# probe <container> <port> <path> <sha>: ready, and not reporting a different version.
probe() {
  docker exec "$1" node -e \
    "fetch('http://127.0.0.1:$2$3').then(async r=>{if(!r.ok)process.exit(1);const b=await r.json().catch(()=>({}));process.exit(b.version&&b.version!==process.argv[1]?2:0)},()=>process.exit(1))" \
    "$4" >/dev/null 2>&1
}

# gate <container> <port> <path> <sha>: /readyz must answer within GATE_SECONDS.
gate() {
  local id="$1" deadline=$((SECONDS + GATE_SECONDS))
  while :; do
    if probe "$@"; then return 0; fi
    [ "$(docker inspect -f '{{.State.Running}}' "$id" 2>/dev/null || echo false)" = true ] || break
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep 2
  done
  log "readiness gate failed for $(docker inspect -f '{{.Name}}' "$id" 2>/dev/null || echo "$id") after ${GATE_SECONDS}s"
  return 1
}

# roll_service <sha> <service>: surge one new container at a time, gate it, then retire an old one,
# so the number of ready containers never drops below the replica count.
roll_service() {
  local sha="$1" svc="$2" port path old new
  read -r port path <<<"${PROBE[$svc]}"
  local -a stale=() cur=() after=()
  local id
  for id in $(compose "$sha" ps -q "$svc"); do
    [ "$(container_sha "$id")" = "$sha" ] || stale+=("$id")
  done
  mapfile -t cur < <(compose "$sha" ps -q "$svc")
  if [ "${#cur[@]}" -eq 0 ]; then
    log "$svc: starting at $sha"
    compose "$sha" up -d --no-deps "$svc"
    for id in $(compose "$sha" ps -q "$svc"); do gate "$id" "$port" "$path" "$sha" || return 1; done
    return 0
  fi
  [ "${#stale[@]}" -gt 0 ] || { log "$svc: already at $sha"; return 0; }
  for old in "${stale[@]}"; do
    mapfile -t cur < <(compose "$sha" ps -q "$svc")
    log "$svc: starting replacement ($((${#cur[@]} + 1)) containers during the roll)"
    compose "$sha" up -d --no-deps --no-recreate --scale "$svc=$((${#cur[@]} + 1))" "$svc"
    mapfile -t after < <(compose "$sha" ps -q "$svc")
    new="$(printf '%s\n' "${after[@]}" | grep -vxF -f <(printf '%s\n' "${cur[@]}") | head -n 1 || true)"
    [ -n "$new" ] || { log "$svc: no replacement container was created"; return 1; }
    if ! gate "$new" "$port" "$path" "$sha"; then
      docker rm -f "$new" >/dev/null 2>&1 || true  # the old container keeps serving
      return 1
    fi
    docker stop -t 20 "$old" >/dev/null && docker rm "$old" >/dev/null
    log "$svc: replaced ${old:0:12} with ${new:0:12}"
  done
}

roll_stack() {
  local sha="$1" svc
  for svc in "${ROLL_ORDER[@]}"; do roll_service "$sha" "$svc" || return 1; done
}

ist_now() { TZ=Asia/Kolkata date +%Y-%m-%dT%H:%M:%S%:z; }

# Restore <sha> and move `current` to it.
rollback_to() {
  local sha="$1"
  make_release_env "$sha" >/dev/null
  roll_stack "$sha"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  : "${CAUSEDECK_ENV_FILE:?set CAUSEDECK_ENV_FILE}"
  target="${1:-}"
  current="$(basename "$(readlink -f "$RELEASES_DIR/current" 2>/dev/null || true)")"
  if [ -z "$target" ]; then
    [ -n "$current" ] && [ -f "$RELEASES_DIR/$current/release.json" ] || { echo "rollback: no current release" >&2; exit 1; }
    target="$(sed -n 's/.*"previous_sha": *"\([0-9a-f]*\)".*/\1/p' "$RELEASES_DIR/$current/release.json")"
    [ -n "$target" ] || { echo "rollback: the current release has no previous sha" >&2; exit 1; }
  fi
  [[ "$target" =~ ^[0-9a-f]{7,40}$ ]] || { echo "rollback: bad sha" >&2; exit 1; }
  log "rolling back to $target"
  rollback_to "$target"
  ln -sfn "$RELEASES_DIR/$target" "$RELEASES_DIR/current"
  log "rolled back to $target at $(ist_now)"
fi
