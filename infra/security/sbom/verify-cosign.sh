#!/usr/bin/env bash
# Verifies an image before deploy (#104, called by the deploy workflow of #100): the cosign keyless
# signature and the CycloneDX attestation must both come from this repository's images workflow.
#
#   REPOSITORY=acme/causedeck bash infra/security/sbom/verify-cosign.sh ghcr.io/acme/causedeck-api@sha256:...
set -euo pipefail

COSIGN_IMAGE="${COSIGN_IMAGE:-gcr.io/projectsigstore/cosign:v2.4.1}"
image="${1:?usage: verify-cosign.sh <image-ref-with-digest>}"
repository="${REPOSITORY:?set REPOSITORY (owner/repo that built the image)}"
case "$image" in *@sha256:*) ;; *) echo "verify-cosign: $image is not pinned by digest" >&2; exit 2 ;; esac

identity="^https://github\.com/${repository//./\\.}/\.github/workflows/images\.yml@refs/heads/main$"
issuer="https://token.actions.githubusercontent.com"
cosign() {
  docker run --rm -v "${HOME}/.docker/config.json:/root/.docker/config.json:ro" "$COSIGN_IMAGE" "$@"
}

cosign verify --certificate-identity-regexp "$identity" --certificate-oidc-issuer "$issuer" "$image" >/dev/null
cosign verify-attestation --type cyclonedx \
  --certificate-identity-regexp "$identity" --certificate-oidc-issuer "$issuer" "$image" >/dev/null
echo "verified signature and SBOM attestation: $image"
