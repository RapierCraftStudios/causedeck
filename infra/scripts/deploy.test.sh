#!/usr/bin/env bash
# Deploy pipeline test (#100), run by .github/workflows/deploy-test.yml against the runner's Docker
# daemon (never on a shared dev host). It drives the real deploy.sh / rollback.sh over a small fake
# stack with the production service names (images answer /readyz with the sha they were started
# with) and asserts: order api, worker, web, admin; one-container-at-a-time rolling with at least one
# web container always ready (continuous probe); release.json and the sha in /readyz; automatic
# rollback to the previous tags when a deliberately unhealthy image fails the gate; manual rollback.
#
#   bash infra/scripts/deploy.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
PROJECT="causedeck-deploytest-$$"
IMAGE="causedeck-deploytest-fake-$$"
SHA_A=aaaaaaa1111111111111111111111111aaaaaaa1
SHA_B=bbbbbbb2222222222222222222222222bbbbbbb2
SHA_C=ccccccc3333333333333333333333333ccccccc3
NODE_IMAGE="${NODE_IMAGE:-node:22.23.0-bookworm-slim}"

# One --label / compose label per entry of $FORGE_DOCKER_LABELS (k=v, whitespace separated).
LABELS=(); LABELS_FLOW=""
for entry in ${FORGE_DOCKER_LABELS:-}; do
  LABELS+=(--label "$entry")
  LABELS_FLOW+="${LABELS_FLOW:+, }\"${entry%%=*}\": \"${entry#*=}\""
done
LABELS_FLOW="{ $LABELS_FLOW }"

export COMPOSE_PROJECT_NAME="$PROJECT"
export RELEASES_DIR="$WORK/releases"
export MIGRATIONS_DIR="$WORK/migrations"
export COMPOSE_FILE="$WORK/compose.yml"
export CAUSEDECK_ENV_FILE="$WORK/base.env"
export GATE_SECONDS=20
PROBE_PID=""

cleanup() {
  [ -z "$PROBE_PID" ] || kill "$PROBE_PID" 2>/dev/null || true
  GIT_SHA="$SHA_A" docker compose -f "$COMPOSE_FILE" --env-file "$CAUSEDECK_ENV_FILE" \
    --profile migrate down -v --remove-orphans >/dev/null 2>&1 || true
  docker rmi -f "$IMAGE:sha-$SHA_A" "$IMAGE:sha-$SHA_B" "$IMAGE:sha-$SHA_C" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() { echo "DEPLOY TEST FAIL: $*" >&2; exit 1; }

mkdir -p "$MIGRATIONS_DIR"
echo 'ALTER TABLE t ADD COLUMN x int;' >"$MIGRATIONS_DIR/0001_expand.sql"
printf 'COMPOSE_ENV_NAME=deploytest\nGIT_SHA=%s\n' "$SHA_A" >"$CAUSEDECK_ENV_FILE"

# --- fake images: a node server whose /readyz reports GIT_SHA; the C image never becomes ready ---
build() { # build <sha> <mode>
  docker build -q "${LABELS[@]}" --build-arg "NODE_IMAGE=$NODE_IMAGE" --build-arg "MODE=$2" \
    -t "$IMAGE:sha-$1" - >/dev/null <<'DOCKERFILE'
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
ARG MODE
ENV MODE=${MODE}
RUN printf '%s\n' \
  "require('http').createServer((q,s)=>{" \
  "if(process.env.MODE==='unhealthy'){s.statusCode=503;return s.end('{}')}" \
  "s.setHeader('content-type','application/json');" \
  "s.end(JSON.stringify({status:'ok',version:process.env.GIT_SHA}))" \
  "}).listen(+process.env.PORT)" >/server.js
CMD ["node","/server.js"]
DOCKERFILE
}
build "$SHA_A" healthy; build "$SHA_B" healthy; build "$SHA_C" unhealthy

cat >"$COMPOSE_FILE" <<YAML
name: $PROJECT
x-app: &app
  image: $IMAGE:sha-\${GIT_SHA:?}
  pull_policy: never
  env_file: \${CAUSEDECK_ENV_FILE:?}
  labels: $LABELS_FLOW
networks:
  default:
    labels: $LABELS_FLOW
services:
  api: { <<: *app, environment: { PORT: '3001' } }
  worker: { <<: *app, environment: { PORT: '3003' }, deploy: { replicas: 2 } }
  web: { <<: *app, environment: { PORT: '3000' }, deploy: { replicas: 2 } }
  admin: { <<: *app, environment: { PORT: '3200' } }
  postgres: { <<: *app, image: $IMAGE:sha-$SHA_A, command: ['sleep', 'infinity'] }
  migrate: { <<: *app, profiles: [migrate], command: ['true'] }
YAML

# Postgres is long-lived and not rolled; start it the way a first-time bootstrap would have.
GIT_SHA="$SHA_A" docker compose -f "$COMPOSE_FILE" --env-file "$CAUSEDECK_ENV_FILE" up -d postgres >/dev/null

web_ids() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=web"; }
ready() { docker exec "$1" node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; }
version_of() { # version_of <service>: the sha every container of the service reports
  local id out=""
  for id in $(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1"); do
    out+="$(docker exec "$id" node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/readyz').then(r=>r.json()).then(b=>console.log(b.version))" 2>/dev/null || echo none) "
  done
  echo "$out"
}
all_at() { # all_at <sha> <replicas by service...>
  local sha="$1" svc want got
  for svc in api:1 worker:2 web:2 admin:1; do
    want="${svc#*:}"; svc="${svc%%:*}"
    got="$(version_of "$svc")"
    [ "$(echo "$got" | wc -w)" -eq "$want" ] || fail "$svc has $(echo "$got" | wc -w) containers, want $want"
    [ "$(echo "$got" | tr ' ' '\n' | grep -c "^$sha$")" -eq "$want" ] || fail "$svc is not all at $sha: $got"
  done
}

echo "test: first deploy of A"
DEPLOYER=tester bash "$ROOT/infra/scripts/deploy.sh" "$SHA_A" >"$WORK/deploy-a.log" 2>&1 || { tail -40 "$WORK/deploy-a.log"; fail "deploy A failed"; }
all_at "$SHA_A"
grep -q "\"sha\":\"$SHA_A\"" "$RELEASES_DIR/$SHA_A/release.json" || fail "release.json lacks sha"
grep -Eq '"time_ist":"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}\+05:30"' "$RELEASES_DIR/$SHA_A/release.json" || fail "release.json time is not IST"
grep -q '"deployer":"tester"' "$RELEASES_DIR/$SHA_A/release.json" || fail "release.json lacks deployer"
grep -q '0001_expand.sql' "$RELEASES_DIR/$SHA_A/release.json" || fail "release.json lacks migrations"
[ "$(basename "$(readlink -f "$RELEASES_DIR/current")")" = "$SHA_A" ] || fail "current does not point at A"

echo "test: rolling deploy of B with a continuous availability probe"
( while :; do
    ok=0
    for id in $(web_ids); do ready "$id" && { ok=1; break; }; done
    [ "$ok" -eq 1 ] || echo "no web container ready at $(date +%T)" >>"$WORK/probe-failures"
    sleep 0.2
  done ) &
PROBE_PID=$!
DEPLOYER=tester bash "$ROOT/infra/scripts/deploy.sh" "$SHA_B" >"$WORK/deploy-b.log" 2>&1 || { tail -40 "$WORK/deploy-b.log"; fail "deploy B failed"; }
kill "$PROBE_PID" 2>/dev/null || true; PROBE_PID=""
[ ! -s "$WORK/probe-failures" ] || fail "web traffic dropped: $(head -3 "$WORK/probe-failures")"
all_at "$SHA_B"
order="$(grep -oE '^deploy: (api|worker|web|admin): starting replacement' "$WORK/deploy-b.log" | awk '{print $2}' | uniq | tr -d ':' | tr '\n' ' ')"
[ "$order" = "api worker web admin " ] || fail "roll order was: $order"
[ "$(grep -c '^deploy: web: starting replacement (3 containers' "$WORK/deploy-b.log")" -eq 2 ] || fail "web did not roll one container at a time"
grep -q "\"previous_sha\":\"$SHA_A\"" "$RELEASES_DIR/$SHA_B/release.json" || fail "release.json lacks previous_sha"

echo "test: unhealthy C triggers automatic rollback to B"
set +e
DEPLOYER=tester bash "$ROOT/infra/scripts/deploy.sh" "$SHA_C" >"$WORK/deploy-c.log" 2>&1
code=$?
set -e
[ "$code" -eq 1 ] || { tail -40 "$WORK/deploy-c.log"; fail "deploy C exited $code, want 1 (failed and rolled back)"; }
all_at "$SHA_B"
[ "$(basename "$(readlink -f "$RELEASES_DIR/current")")" = "$SHA_B" ] || fail "current moved off B"
grep -q '"status":"rolled-back"' "$RELEASES_DIR/$SHA_C/release.json" || fail "release C not marked rolled-back"
grep -q "rolled back to \`$SHA_B\`" "$RELEASES_DIR/$SHA_C/failure-summary.md" || fail "failure summary missing"

echo "test: manual rollback restores the previous release (A)"
bash "$ROOT/infra/scripts/rollback.sh" >"$WORK/rollback.log" 2>&1 || { tail -40 "$WORK/rollback.log"; fail "rollback.sh failed"; }
all_at "$SHA_A"
[ "$(basename "$(readlink -f "$RELEASES_DIR/current")")" = "$SHA_A" ] || fail "current not moved to A"

echo "test: ok"
