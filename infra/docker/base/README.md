# Pinned base images

Every image is built from a pinned base. The Dockerfiles take the base as a build argument whose
default is a version tag (readable, works offline); `images.yml` resolves each tag to its digest and
passes `name@sha256:...` so what ships is immutable.

| Build arg    | Default tag                           | Used by                      |
| ------------ | ------------------------------------- | ---------------------------- |
| `NODE_IMAGE` | `node:22.23.0-bookworm-slim`          | web, api, worker, admin      |
| `PG_IMAGE`   | `pgvector/pgvector:0.8.7-pg17`        | postgres                     |
| (compose)    | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | minio                   |
| (compose)    | `caddy:2.10-alpine`                   | caddy (config is #98)        |

## Refreshing

1. Bump the tag in the Dockerfile default (and `compose.prod.yml` for compose-pulled images).
2. Resolve the digest for both architectures:
   `docker buildx imagetools inspect node:22.23.0-bookworm-slim --format '{{json .Manifest.Digest}}'`
3. For a manual build pass it explicitly:
   `docker build --build-arg NODE_IMAGE=node@sha256:<digest> -f infra/docker/api.Dockerfile .`
4. WAL-G is not a base image: bump `WALG_VERSION` and both `WALG_SHA256_*` build args together
   (checksums come from the release page; the build fails if they do not match).
5. Trivy runs on every image in `images.yml`; a critical finding with a fix fails the build.

`.dockerignore`: Docker only reads it from the context root (or beside a Dockerfile as
`<name>.Dockerfile.dockerignore`), so `images.yml` copies `infra/docker/.dockerignore` to the repo
root before building.
