#!/bin/sh
# Stage B Postgres cutover helper (#887, rented-server path): logical replication from the Stage A
# compose Postgres to the dedicated Postgres primary on OVH Mumbai (infra/docker/compose.db.yml), with
# row-count and RLS verification, a measured read-only window and a promote step. POSIX sh. It never
# runs from CI and never by itself: the default is a dry run that prints the plan; changes need
# --execute. For the AWS RDS option use migrate-postgres-to-rds.sh.
#
#   migrate-compose-to-dedicated-postgres.sh [plan]            print every step (default, no connection)
#   migrate-compose-to-dedicated-postgres.sh --execute setup   publication on source, subscription on target
#   migrate-compose-to-dedicated-postgres.sh --execute verify  row counts and RLS state, source against target
#   migrate-compose-to-dedicated-postgres.sh --execute cutover read-only window, catch-up, verify, report downtime
#   migrate-compose-to-dedicated-postgres.sh --execute promote copy sequences, drop the subscription: target is a primary
#   migrate-compose-to-dedicated-postgres.sh --execute rollback reopen the source for writes, drop the subscription
#
# Env: SOURCE_URL, TARGET_URL (required for --execute). TARGET_ALLOWED_HOSTS is a comma-separated
# list of the dedicated nodes' hosts (from `terraform output` of envs/stage-b-ovh, all in YNM); the
# target host must be on it and TARGET_URL must use sslmode=require or verify-full. A local scratch
# target needs ALLOW_LOCAL_TARGET=1 (rehearsal only). SUBSCRIPTION_SOURCE_URL is how the target
# reaches the source (defaults to SOURCE_URL). The source needs wal_level = logical (restart once,
# runbook pre-check). Row-count and RLS checks follow infra/scripts/restore/verify.sql.
set -eu

PUBLICATION=${PUBLICATION:-causedeck_cutover}
SUBSCRIPTION=${SUBSCRIPTION:-causedeck_cutover}
CATCHUP_TIMEOUT=${CATCHUP_TIMEOUT:-300}

execute=0
mode=plan
while [ $# -gt 0 ]; do
  case "$1" in
    --execute) execute=1 ;;
    plan | setup | verify | cutover | promote | rollback) mode=$1 ;;
    -h | --help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "migrate-compose-to-dedicated-postgres: unknown argument '$1'" >&2
      exit 2
      ;;
  esac
  shift
done

die() {
  echo "migrate-compose-to-dedicated-postgres: $1" >&2
  exit 1
}

host_of() {
  rest=${1#*://}
  rest=${rest##*@}
  rest=${rest%%/*}
  rest=${rest%%\?*}
  printf %s "${rest%%:*}" | tr 'A-Z' 'a-z'
}

# Residency guard: the target must be one of the listed dedicated nodes (all ordered in YNM, see
# envs/stage-b-ovh) and the connection must be encrypted; local only for a rehearsal scratch database.
assert_india_target() {
  host=$(host_of "$1")
  case "$host" in
    localhost | 127.0.0.1 | scratch-postgres)
      [ "${ALLOW_LOCAL_TARGET:-0}" = 1 ] && return 0
      die "local target '$host' needs ALLOW_LOCAL_TARGET=1 (rehearsal only)"
      ;;
  esac
  [ -n "${TARGET_ALLOWED_HOSTS:-}" ] || die "set TARGET_ALLOWED_HOSTS to the dedicated Postgres node host(s) in YNM"
  case ",$(printf %s "$TARGET_ALLOWED_HOSTS" | tr 'A-Z' 'a-z' | tr -d ' ')," in
    *",$host,"*) ;;
    *) die "target host '$host' is not in TARGET_ALLOWED_HOSTS (a dedicated node in OVH Mumbai YNM)" ;;
  esac
  case "$1" in
    *sslmode=require* | *sslmode=verify-full* | *sslmode=verify-ca*) ;;
    *) die "TARGET_URL must set sslmode=require or sslmode=verify-full" ;;
  esac
}

print_plan() {
  cat <<PLAN
Plan (dry run, nothing was executed; add --execute to run a step):
  0. pre-check: source wal_level must be logical (ALTER SYSTEM SET wal_level = logical, one restart
               in a quiet window); the target is a fresh compose.db.yml primary, schema loaded with
               pnpm db:migrate as the owner role
  1. setup:    on source  CREATE PUBLICATION $PUBLICATION FOR ALL TABLES
               on target  CREATE EXTENSION vector, then
                          CREATE SUBSCRIPTION $SUBSCRIPTION CONNECTION '<source>' PUBLICATION $PUBLICATION
  2. verify:   row count per public table and RLS state (relrowsecurity, relforcerowsecurity,
               policy count) on source and target must match
  3. cutover:  source ALTER DATABASE ... SET default_transaction_read_only = on (start of the window),
               wait until the subscription has caught up (timeout ${CATCHUP_TIMEOUT}s), verify again,
               print the measured downtime
  4. promote:  copy every public sequence value from source to target (logical replication does not
               carry sequences), DROP SUBSCRIPTION $SUBSCRIPTION; the target is now an independent
               primary; then switch DATABASE_URL to PgBouncer (runbook step)
  5. rollback: source ALTER DATABASE ... RESET default_transaction_read_only, DROP SUBSCRIPTION $SUBSCRIPTION
Rollback hints: until DATABASE_URL points at the new primary the source is authoritative; run
'rollback' and keep the old DATABASE_URL. After writes landed on the new primary, do not roll back
without reverse replication.
PLAN
}

if [ "$execute" -eq 0 ]; then
  print_plan
  exit 0
fi

[ "$mode" != plan ] || die "--execute needs a step: setup, verify, cutover, promote or rollback"
: "${SOURCE_URL:?set SOURCE_URL}"
: "${TARGET_URL:?set TARGET_URL}"
assert_india_target "$TARGET_URL"
SUBSCRIPTION_SOURCE_URL=${SUBSCRIPTION_SOURCE_URL:-$SOURCE_URL}

q() { psql "$1" -v ON_ERROR_STOP=1 -Atq -c "$2"; }

dbname() { q "$1" 'select current_database()'; }

setup() {
  level=$(q "$SOURCE_URL" "select current_setting('wal_level')")
  [ "$level" = logical ] || die "source wal_level is '$level', not logical: set it and restart the source once (runbook pre-check)"
  q "$SOURCE_URL" "create publication $PUBLICATION for all tables"
  q "$TARGET_URL" "create extension if not exists vector"
  q "$TARGET_URL" "create subscription $SUBSCRIPTION connection '$SUBSCRIPTION_SOURCE_URL' publication $PUBLICATION"
  echo "setup: publication and subscription created; run verify when the initial copy is done"
}

counts() {
  q "$1" "select c.relname || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname not like 'pgboss%' order by 1"
}

rls_state() {
  q "$1" "select c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity || ':' ||
                 (select count(*) from pg_policy p where p.polrelid = c.oid)
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' order by 1"
}

verify() {
  src=${TMPDIR:-/tmp}/migrate-src.$$
  dst=${TMPDIR:-/tmp}/migrate-dst.$$
  trap 'rm -f "$src" "$dst"' EXIT
  counts "$SOURCE_URL" >"$src"
  counts "$TARGET_URL" >"$dst"
  cmp -s "$src" "$dst" || {
    diff "$src" "$dst" >&2 || true
    die "row counts differ between source and target"
  }
  rls_state "$SOURCE_URL" >"$src"
  rls_state "$TARGET_URL" >"$dst"
  cmp -s "$src" "$dst" || {
    diff "$src" "$dst" >&2 || true
    die "RLS state (enabled, forced, policy count) differs between source and target"
  }
  echo "verify: $(wc -l <"$src" | tr -d ' ') tables, row counts and RLS state match"
}

replication_lag() {
  q "$SOURCE_URL" "select coalesce(max(pg_current_wal_lsn() - confirmed_flush_lsn), 0) from pg_replication_slots where slot_type = 'logical'"
}

cutover() {
  db=$(dbname "$SOURCE_URL")
  started=$(date +%s)
  q "$SOURCE_URL" "alter database \"$db\" set default_transaction_read_only = on"
  echo "cutover: source is read-only (new sessions); window started"
  waited=0
  while :; do
    lag=$(replication_lag)
    [ "$lag" = 0 ] && break
    waited=$((waited + 2))
    if [ "$waited" -gt "$CATCHUP_TIMEOUT" ]; then
      q "$SOURCE_URL" "alter database \"$db\" reset default_transaction_read_only"
      die "subscription did not catch up in ${CATCHUP_TIMEOUT}s; source reopened for writes"
    fi
    sleep 2
  done
  if ! (verify); then
    q "$SOURCE_URL" "alter database \"$db\" reset default_transaction_read_only"
    die "verification failed; source reopened for writes"
  fi
  ended=$(date +%s)
  echo "cutover: verified; run promote, then switch DATABASE_URL; downtime so far $((ended - started))s (record it in the runbook)"
}

# Logical replication does not carry sequence values: without this step the first INSERT on the new
# primary would reuse an id that already exists.
copy_sequences() {
  list=$(q "$SOURCE_URL" "select format('%I.%I', schemaname, sequencename) || ' ' || last_value from pg_sequences where schemaname = 'public' and last_value is not null order by 1")
  n=0
  oldifs=$IFS
  IFS='
'
  for line in $list; do
    seq=${line% *}
    val=${line##* }
    q "$TARGET_URL" "select setval('$seq', $val)" >/dev/null
    n=$((n + 1))
  done
  IFS=$oldifs
  echo "promote: copied $n sequence value(s) to the target"
}

drop_subscription() {
  q "$TARGET_URL" "alter subscription $SUBSCRIPTION disable"
  q "$TARGET_URL" "alter subscription $SUBSCRIPTION set (slot_name = none)"
  q "$TARGET_URL" "drop subscription $SUBSCRIPTION"
  q "$SOURCE_URL" "select pg_drop_replication_slot('$SUBSCRIPTION') where exists (select 1 from pg_replication_slots where slot_name = '$SUBSCRIPTION')" >/dev/null
}

promote() {
  [ "$(replication_lag)" = 0 ] || die "subscription has not caught up; run cutover first (the source must be read-only)"
  verify
  copy_sequences
  drop_subscription
  echo "promote: subscription dropped; the target is an independent primary. The source stays read-only: switch DATABASE_URL now"
}

rollback() {
  db=$(dbname "$SOURCE_URL")
  q "$SOURCE_URL" "alter database \"$db\" reset default_transaction_read_only"
  drop_subscription
  echo "rollback: source reopened for writes; keep the old DATABASE_URL"
}

"$mode"
