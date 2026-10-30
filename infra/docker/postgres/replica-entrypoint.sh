#!/bin/sh
# Replica bootstrap for compose.db.yml (#887). POSIX sh, runs as the postgres user in the
# causedeck-postgres image. On an empty data directory it clones the primary with pg_basebackup -R
# (writes standby.signal and primary_conninfo, -C -S creates the physical replication slot), then
# execs postgres with the arguments from the compose command. A directory that already holds a
# cluster is started as is: the standby resumes from its slot.
# Env: PRIMARY_HOST (required), PGPASSWORD (the replicator password), PGSSLMODE, REPLICA_SLOT.
set -eu

PGDATA=${PGDATA:-/var/lib/postgresql/data}
SLOT=${REPLICA_SLOT:-replica1}
: "${PRIMARY_HOST:?set PRIMARY_HOST}"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "replica-entrypoint: empty data directory, cloning $PRIMARY_HOST"
  # The mounted volume is owned by postgres; the directory must be 0700 for postgres to start.
  chmod 0700 "$PGDATA"
  until pg_isready -h "$PRIMARY_HOST" -p 5432 -q; do
    echo "replica-entrypoint: waiting for the primary"
    sleep 3
  done
  pg_basebackup -h "$PRIMARY_HOST" -p 5432 -U replicator -D "$PGDATA" \
    -X stream -R -C -S "$SLOT" --checkpoint=fast --no-password
fi

# standby.signal is what keeps the node read-only and replaying WAL; refuse to start without it.
[ -f "$PGDATA/standby.signal" ] || {
  echo "replica-entrypoint: $PGDATA/standby.signal is missing; this directory is not a standby" >&2
  exit 1
}

exec "$@"
