# Custom Caddy with the rate-limit module (#98). Versions are pinned: bump both deliberately and
# update the image tag in infra/docker/compose.prod.yml. Built in CI (images.yml) and on deploy.
ARG CADDY_VERSION=2.10.2
FROM caddy:${CADDY_VERSION}-builder-alpine AS build
# mholt/caddy-ratelimit has no tagged releases: pinned by commit.
ARG RATELIMIT_COMMIT=5625512f24f6f59d6f64fb3aafe5eecff0b286db
# The pre-FROM ARG is out of scope here, so the shell sees the builder image's own
# ENV CADDY_VERSION=v2.10.2 (an ENV also wins over a redeclared ARG). Strip and re-add the `v` so
# either form gives v2.10.2; `v${CADDY_VERSION}` became `vv2.10.2` and xcaddy failed (#1104).
RUN xcaddy build "v${CADDY_VERSION#v}" --with github.com/mholt/caddy-ratelimit@${RATELIMIT_COMMIT}

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
