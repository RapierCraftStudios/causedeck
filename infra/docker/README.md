# Local development stack

`infra/docker/compose.dev.yml` runs the services the apps need on a developer machine (spike §1, §3.1). Nothing here contacts an external service, and every port binds to `127.0.0.1`.

```sh
pnpm run doctor   # Node 22, pnpm 10, Docker daemon, free ports (`run` is required: `pnpm doctor` is a pnpm built-in)
pnpm stack:up     # start, wait until healthy, create the bucket, print URLs
pnpm dev          # stack:up, then every app dev server (Turborepo)
pnpm stack:down   # stop; data volumes are kept
pnpm stack:reset  # delete the volumes (asks for "yes"; --yes skips the prompt)
```

The Compose project is `causedeck-dev`, so `docker compose -f infra/docker/compose.dev.yml <cmd>` (for example `logs -f postgres` or `ps`) works from the repo root.

## Services

| Service | Image | Host ports | Volume | Purpose |
|---|---|---|---|---|
| `postgres` | `pgvector/pgvector:0.8.7-pg17` | `127.0.0.1:5432` | `pgdata` | PostgreSQL 17 with `vector`, `pgcrypto`, `citext`, `pg_trgm`, `unaccent` and the owner and app roles (`postgres/init/`) |
| `minio` | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | `127.0.0.1:9000` (S3 API), `127.0.0.1:9001` (console) | `miniodata` | S3-compatible object storage |
| `minio-init` | `pgsty/mc:RELEASE.2026-10-18T00-00-00Z` | none | none | One-shot: creates bucket `causedeck-dev` and enables versioning (run by `stack:up`; profile `init`) |
| `mailpit` | `axllent/mailpit:v1.31` | `127.0.0.1:1025` (SMTP), `127.0.0.1:8025` (web UI) | none | Catches every outgoing email |

Images are pinned to version tags, never `latest`. MinIO no longer publishes the official `minio/minio` and `minio/mc` images, so the stack uses the community-maintained builds of the same server and client (`pgsty/*`).

## Local-only credentials

These are documented dev defaults. **Never use them in staging or production.**

The root `.env.example` is generated from the env schema (`pnpm env:example`, see [docs/engineering/env.md](../../docs/engineering/env.md)), so do not edit it. To point the apps at this stack's roles and bucket, put these in a git-ignored `.env.local`:

```sh
DATABASE_URL=postgres://causedeck_app:causedeck_app@127.0.0.1:5432/causedeck
DATABASE_URL_OWNER=postgres://causedeck_owner:causedeck_owner@127.0.0.1:5432/causedeck
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=causedeck-dev
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
SMTP_URL=smtp://127.0.0.1:1025
```

| What | User | Password | Notes |
|---|---|---|---|
| Postgres superuser | `causedeck` | `causedeck` | Database `causedeck`; for admin work in `psql` only |
| Postgres owner role | `causedeck_owner` | `causedeck_owner` | Owns the database and schema `public`; runs migrations (`DATABASE_URL_OWNER`) |
| Postgres app role | `causedeck_app` | `causedeck_app` | What the apps use (`DATABASE_URL`): not an owner, `NOBYPASSRLS`, cannot `CREATE` in `public`; gets `SELECT/INSERT/UPDATE/DELETE` on tables the owner creates |
| Postgres clerk role | `causedeck_clerk` | none (`NOLOGIN`) | The app role switches to it for clerk members (`withWorkspace({ dbRole: 'clerk' })`); no grant on base tables behind clerk views. Migration `0016_matter_restriction` fails until it exists |
| MinIO root | `minioadmin` | `minioadmin` | S3 access and secret key, and the console login |
| Mailpit | none | none | No authentication |

A `pgdata` volume created before the clerk role (#233) does not get it, because the init scripts
only run on an empty volume. Add it once, then migrate:

```sh
docker compose -f infra/docker/compose.dev.yml exec -T postgres psql -U causedeck -d causedeck -c \
  "CREATE ROLE causedeck_clerk NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "GRANT USAGE ON SCHEMA public TO causedeck_clerk" -c "GRANT causedeck_clerk TO causedeck_app"
```

## Checking the stack

```sh
# Postgres version, extensions and the app role (expects 17.x; the five extensions; f|f; f)
docker compose -f infra/docker/compose.dev.yml exec -T postgres psql -U causedeck -d causedeck -Atc \
  "show server_version" -c "select extname from pg_extension" \
  -c "select rolsuper, rolbypassrls from pg_roles where rolname = 'causedeck_app'" \
  -c "select has_schema_privilege('causedeck_app', 'public', 'CREATE')"

# MinIO: versioning and a presigned upload/download round-trip with mc
docker run --rm -it --network host --entrypoint sh pgsty/mc:RELEASE.2026-10-18T00-00-00Z
mc alias set local http://127.0.0.1:9000 minioadmin minioadmin
mc version info local/causedeck-dev          # "versioning is enabled"
mc share upload local/causedeck-dev/probe.txt     # prints a presigned curl upload command
mc share download local/causedeck-dev/probe.txt   # prints a presigned GET URL

# Mailpit: send through SMTP, then open http://localhost:8025
python3 -c "import smtplib; smtplib.SMTP('localhost', 1025).sendmail('a@x.test', ['b@x.test'], 'Subject: hi\n\nhello')"
```

## API image

`infra/docker/api.Dockerfile` builds the Hono API (`apps/api`, #14). It runs as the non-root `node` user, listens on `API_PORT` (default 3001), has a `HEALTHCHECK` on `/healthz`, and on `SIGTERM` stops accepting connections and drains in-flight requests for up to 10 s before exiting 0.

```sh
docker build -f infra/docker/api.Dockerfile -t causedeck-api .
# The server validates the full server env at startup and exits if it is incomplete, so pass an
# env file (production values come from the secret manager, never from this repo).
docker run --rm -p 127.0.0.1:3001:3001 --env-file .env.api causedeck-api
curl -s http://127.0.0.1:3001/healthz
```

Nothing connects to Postgres until the first request that needs it, so `/healthz` answers even before the database is reachable; `/readyz` reports the `db` check.

## Troubleshooting

- **`pnpm run doctor` reports a port in use.** Another Postgres, MinIO or mail sink is listening; `lsof -i :5432` shows which process. If it is this stack, `pnpm stack:down` stops it.
- **Docker daemon not reachable.** Start Docker Desktop, OrbStack or `sudo systemctl start docker`, then check that `docker info` works.
- **Init SQL changes do not apply.** Scripts in `postgres/init/` run only when the `pgdata` volume is first created. Run `pnpm stack:reset` and then `pnpm stack:up`.
- **`stack:up` times out on a healthcheck.** `docker compose -f infra/docker/compose.dev.yml logs <service>` shows why. A corrupt volume is fixed with `pnpm stack:reset`.
- **`stack:reset` refuses to run in a script.** It needs a terminal for the prompt. Pass `--yes` (`pnpm stack:reset --yes`) when deleting the data is intended.
