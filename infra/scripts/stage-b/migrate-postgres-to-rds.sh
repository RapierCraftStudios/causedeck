#!/bin/sh
# Stage B Postgres cutover helper (#106): logical replication from the compose Postgres to RDS (or a
# scratch Postgres for the rehearsal), with row-count and RLS verification and a measured
# read-only window. POSIX sh. It never runs from CI and never by itself: the default is a dry run
# that prints the plan; changes need --execute.
#
#   migrate-postgres-to-rds.sh [plan]            print every step (default, no connection made)
#   migrate-postgres-to-rds.sh --execute setup   publication on source, subscription on target
#   migrate-postgres-to-rds.sh --execute verify  row counts and RLS state, source against target
#   migrate-postgres-to-rds.sh --execute cutover read-only window, catch-up, verify, report downtime
#   migrate-postgres-to-rds.sh --execute rollback  reopen the source for writes, drop the subscription
#
# Env: SOURCE_URL, TARGET_URL (required for --execute). The target host must be an RDS endpoint in
# ap-south-1 or ap-south-2; a local scratch target needs ALLOW_LOCAL_TARGET=1 (rehearsal only).
# Row-count and RLS checks follow infra/scripts/restore/verify.sql.
set -eu

PUBLICATION=${PUBLICATION:-causedeck_cutover}
SUBSCRIPTION=${SUBSCRIPTION:-causedeck_cutover}
CATCHUP_TIMEOUT=${CATCHUP_TIMEOUT:-300}

execute=0
mode=plan
while [ $# -gt 0 ]; do
  case "$1" in
    --execute) execute=1 ;;
    plan | setup | verify | cutover | rollback) mode=$1 ;;
    -h | --help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "migrate-postgres-to-rds: unknown argument '$1'" >&2
      exit 2
      ;;
  esac
  shift
done

die() {
  echo "migrate-postgres-to-rds: $1" >&2
  exit 1
}

host_of() {
  rest=${1#*://}
  rest=${rest##*@}
  rest=${rest%%/*}
  rest=${rest%%\?*}
  printf %s "${rest%%:*}" | tr 'A-Z' 'a-z'
}

# India endpoint guard: RDS in an India region only; local only for a rehearsal scratch database.
assert_india_target_host() {
  host=$(host_of "$1")
  case "$host" in
    *.ap-south-1.rds.amazonaws.com | *.ap-south-2.rds.amazonaws.com) return 0 ;;
    localhost | 127.0.0.1 | scratch-postgres)
      [ "${ALLOW_LOCAL_TARGET:-0}" = 1 ] && return 0
      die "local target '$host' needs ALLOW_LOCAL_TARGET=1 (rehearsal only)"
      ;;
  esac
  die "target host '$host' is not an RDS endpoint in ap-south-1 or ap-south-2"
}

print_plan() {
  cat <<PLAN
Plan (dry run, nothing was executed; add --execute to run a step):
  1. setup:    on source  CREATE PUBLICATION $PUBLICATION FOR ALL TABLES
               on target  load the schema (pnpm db:migrate), CREATE EXTENSION vector, then
                          CREATE SUBSCRIPTION $SUBSCRIPTION CONNECTION '<source>' PUBLICATION $PUBLICATION
  2. verify:   row count per public table and RLS state (relrowsecurity, relforcerowsecurity,
               policy count) on source and target must match
  3. cutover:  source ALTER DATABASE ... SET default_transaction_read_only = on (start of the window),
               wait until the subscription has caught up (timeout ${CATCHUP_TIMEOUT}s), verify again,
               print the measured downtime; then switch DATABASE_URL (runbook step)
  4. rollback: source ALTER DATABASE ... RESET default_transaction_read_only, DROP SUBSCRIPTION $SUBSCRIPTION
Rollback hints: until DATABASE_URL points at RDS the source is authoritative; run 'rollback' and
keep the old DATABASE_URL. After writes landed on RDS, do not roll back without reverse replication.
PLAN
}

if [ "$execute" -eq 0 ]; then
  print_plan
  exit 0
fi

[ "$mode" != plan ] || die "--execute needs a step: setup, verify, cutover or rollback"
: "${SOURCE_URL:?set SOURCE_URL}"
: "${TARGET_URL:?set TARGET_URL}"
assert_india_target_host "$TARGET_URL"

q() { psql "$1" -v ON_ERROR_STOP=1 -Atq -c "$2"; }

dbname() { q "$1" 'select current_database()'; }

setup() {
  q "$SOURCE_URL" "create publication $PUBLICATION for all tables"
  q "$TARGET_URL" "create extension if not exists vector"
  q "$TARGET_URL" "create subscription $SUBSCRIPTION connection '$SOURCE_URL' publication $PUBLICATION"
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

cutover() {
  db=$(dbname "$SOURCE_URL")
  started=$(date +%s)
  q "$SOURCE_URL" "alter database \"$db\" set default_transaction_read_only = on"
  echo "cutover: source is read-only (new sessions); window started"
  waited=0
  while :; do
    lag=$(q "$SOURCE_URL" "select coalesce(max(pg_current_wal_lsn() - confirmed_flush_lsn), 0) from pg_replication_slots where slot_type = 'logical'")
    [ "$lag" = 0 ] && break
    waited=$((waited + 2))
    if [ "$waited" -gt "$CATCHUP_TIMEOUT" ]; then
      q "$SOURCE_URL" "alter database \"$db\" reset default_transaction_read_only"
      die "subscription did not catch up in ${CATCHUP_TIMEOUT}s; source reopened for writes"
    fi
    sleep 2
  done
  if ! verify; then
    q "$SOURCE_URL" "alter database \"$db\" reset default_transaction_read_only"
    die "verification failed; source reopened for writes"
  fi
  ended=$(date +%s)
  echo "cutover: ready to switch DATABASE_URL; downtime so far $((ended - started))s (record it in the runbook)"
}

rollback() {
  db=$(dbname "$SOURCE_URL")
  q "$SOURCE_URL" "alter database \"$db\" reset default_transaction_read_only"
  q "$TARGET_URL" "alter subscription $SUBSCRIPTION disable"
  q "$TARGET_URL" "alter subscription $SUBSCRIPTION set (slot_name = none)"
  q "$TARGET_URL" "drop subscription $SUBSCRIPTION"
  q "$SOURCE_URL" "select pg_drop_replication_slot('$SUBSCRIPTION') where exists (select 1 from pg_replication_slots where slot_name = '$SUBSCRIPTION')"
  echo "rollback: source reopened for writes; keep the old DATABASE_URL"
}

"$mode"
