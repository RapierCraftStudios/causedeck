#!/usr/bin/env bash
# CycloneDX SBOM for one image (#104): trivy image --format cyclonedx. Output defaults to
# sbom-<name>.cdx.json in the current directory. The Trivy image is pinned by digest.
#
#   bash infra/security/sbom/generate.sh ghcr.io/acme/causedeck-api@sha256:... [out.json]
set -euo pipefail

TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:0.58.1@sha256:ab70a02200597efa04748f210f793936eb647cbcdb0ea69cc30b226d6f5a22c7}"
image="${1:?usage: generate.sh <image-ref> [output.json]}"
name="${image##*/}"; name="${name%%[@:]*}"
out="${2:-sbom-$name.cdx.json}"
dir="$(cd "$(dirname "$out")" && pwd)"

docker run --rm -e TRIVY_USERNAME -e TRIVY_PASSWORD -v "$dir:/out" "$TRIVY_IMAGE" \
  image --format cyclonedx --output "/out/$(basename "$out")" "$image"
echo "wrote $dir/$(basename "$out")"
