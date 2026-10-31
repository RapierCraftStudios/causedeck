#!/usr/bin/env bash
# Runs on the GitHub runner (#100): ships the release bundle to the VPS and runs deploy.sh, smoke.sh
# or reads the failure summary there, over SSH with a PINNED host key (StrictHostKeyChecking=yes
# against DEPLOY_KNOWN_HOSTS; there is no trust-on-first-use). Secrets come from the GitHub
# environment of the calling job and are only ever passed through the environment or stdin.
#
#   SHA=<gitsha> DEPLOY_ENVIRONMENT=staging|production remote-deploy.sh deploy|smoke|summary
#
# Required env: DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS (deploy also: GHCR_USER
# GHCR_PULL_TOKEN, the read-only registry token for the VPS). Optional: ACTOR, DEPLOY_ENV_FILE.
set -euo pipefail

action="${1:?usage: remote-deploy.sh deploy|smoke|summary}"
: "${SHA:?}" "${DEPLOY_ENVIRONMENT:?}" "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "remote-deploy: SHA must be a full 40-character commit sha" >&2; exit 1; }
[[ "$DEPLOY_ENVIRONMENT" =~ ^(staging|production)$ ]] || { echo "remote-deploy: bad environment" >&2; exit 1; }
[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9.:-]+$ && "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "remote-deploy: bad host or user" >&2; exit 1; }

RELEASES=/opt/causedeck/releases
ENV_FILE="${DEPLOY_ENV_FILE:-/etc/causedeck/$DEPLOY_ENVIRONMENT.env}"
KEYDIR="$(mktemp -d)"
trap 'rm -rf "$KEYDIR"' EXIT
(umask 077; printf '%s\n' "$DEPLOY_SSH_KEY" >"$KEYDIR/key"; printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >"$KEYDIR/known_hosts")
SSH_OPTS=(-i "$KEYDIR/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$KEYDIR/known_hosts")
remote() { ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$@"; }
env_prefix="CAUSEDECK_ENV_FILE='$ENV_FILE' RELEASES_DIR='$RELEASES'"

case "$action" in
  deploy)
    : "${GHCR_USER:?}" "${GHCR_PULL_TOKEN:?}"
    git archive --format=tar.gz -o "$KEYDIR/bundle.tgz" "$SHA" infra packages/db/migrations
    remote "mkdir -p '$RELEASES/$SHA/bundle'"
    scp "${SSH_OPTS[@]}" "$KEYDIR/bundle.tgz" "$DEPLOY_USER@$DEPLOY_HOST:$RELEASES/$SHA/bundle.tgz"
    printf '%s' "$GHCR_PULL_TOKEN" | remote "docker login ghcr.io -u '$GHCR_USER' --password-stdin" >/dev/null
    actor="$(printf '%s' "${ACTOR:-github-actions}" | tr -c 'A-Za-z0-9._-' '_')"
    remote "tar -xzf '$RELEASES/$SHA/bundle.tgz' -C '$RELEASES/$SHA/bundle' && $env_prefix DEPLOYER='$actor' bash '$RELEASES/$SHA/bundle/infra/scripts/deploy.sh' '$SHA'"
    ;;
  smoke)
    remote "$env_prefix bash '$RELEASES/$SHA/bundle/infra/scripts/smoke.sh' '$SHA'"
    ;;
  summary)
    remote "cat '$RELEASES/$SHA/failure-summary.md'" || true
    ;;
  *) echo "remote-deploy: unknown action $action" >&2; exit 1 ;;
esac
