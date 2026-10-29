#!/bin/sh
# Streaming-replication role (#887). Runs once on a fresh primary data volume. A no-op unless
# REPLICATION_PASSWORD is set, so Stage A and the dev stack are unchanged.
set -eu
[ -n "${REPLICATION_PASSWORD:-}" ] || exit 0
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" --set=pw="$REPLICATION_PASSWORD" <<'SQL'
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD :'pw';
SQL
