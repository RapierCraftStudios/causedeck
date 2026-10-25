# Production Postgres 17 + pgvector + WAL-G (#97). Build from the repo root:
#   docker build -f infra/docker/postgres/Dockerfile -t causedeck-postgres .
# Pin PG_IMAGE by digest in CI (see base/README.md). WAL-G is downloaded per architecture and
# verified against a SHA-256 supplied as a build arg, so a swapped release asset fails the build.
ARG PG_IMAGE=pgvector/pgvector:0.8.7-pg17

FROM ${PG_IMAGE} AS walg
ARG TARGETARCH
ARG WALG_VERSION=v3.0.5
ARG WALG_SHA256_AMD64
ARG WALG_SHA256_ARM64
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) arch=amd64; sha="${WALG_SHA256_AMD64}" ;; \
    arm64) arch=aarch64; sha="${WALG_SHA256_ARM64}" ;; \
    *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  test -n "${sha}" || { echo "WALG_SHA256_${TARGETARCH} build arg is required" >&2; exit 1; }; \
  curl -fsSL -o /wal-g "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-ubuntu-22.04-${arch}"; \
  echo "${sha}  /wal-g" | sha256sum -c -; \
  chmod 0755 /wal-g

FROM ${PG_IMAGE}
ENV TZ=UTC
COPY --from=walg /wal-g /usr/local/bin/wal-g
COPY infra/docker/postgres/postgresql.conf /etc/postgresql/postgresql.conf
# Self-signed certificate for in-network TLS (clients use sslmode=require over the private network;
# the public edge certificate is Caddy's). Generated at build time, readable by `postgres` only.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /etc/postgresql/tls \
  && openssl req -x509 -nodes -newkey rsa:3072 -days 3650 -subj "/CN=postgres" \
    -keyout /etc/postgresql/tls/server.key -out /etc/postgresql/tls/server.crt \
  && chown -R postgres:postgres /etc/postgresql/tls \
  && chmod 0600 /etc/postgresql/tls/server.key
# Extensions, then the owner and app roles (runs once, on a fresh data volume).
COPY infra/docker/postgres/init /docker-entrypoint-initdb.d
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
