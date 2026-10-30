# Custom Caddy with the rate-limit module (#98). Versions are pinned: bump both deliberately and
# update the image tag in infra/docker/compose.prod.yml. Built in CI (images.yml) and on deploy.
ARG CADDY_VERSION=2.10.2
FROM caddy:${CADDY_VERSION}-builder-alpine AS build
# mholt/caddy-ratelimit has no tagged releases: pinned by commit.
ARG RATELIMIT_COMMIT=5625512f24f6f59d6f64fb3aafe5eecff0b286db
RUN xcaddy build v${CADDY_VERSION} --with github.com/mholt/caddy-ratelimit@${RATELIMIT_COMMIT}

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
