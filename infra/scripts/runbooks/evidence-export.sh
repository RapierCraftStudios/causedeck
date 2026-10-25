#!/usr/bin/env bash
# Evidence export (#103, runbooks cert-in-6h.md and dpdp-breach.md): pull the logs of a time range
# from Loki (180-day India store, #102) into an encrypted archive with a manifest and hashes.
#
#   evidence-export.sh --from <RFC3339> --to <RFC3339> [--query '<LogQL>'] [--out <dir>]
#
# Env: LOKI_URL (default http://127.0.0.1:3100), EVIDENCE_KEY_FILE (path to a passphrase file from
#      custody; never inline), optional EVIDENCE_S3_ENDPOINT + EVIDENCE_S3_BUCKET (+ _ACCESS_KEY/_SECRET_KEY) to copy the
#      archive to India object storage with `mc` (endpoint checked by backup/lib/india-guard.sh).
# Output in --out (default ./evidence-<UTC stamp>): evidence-<id>.tar.enc (AES-256-CBC, PBKDF2),
#   evidence-<id>.manifest.json (entries, per-file sha256 of the plaintext, sha256 of the archive)
#   and evidence-<id>.tar.enc.sha256. Decrypt:
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:$EVIDENCE_KEY_FILE -in <archive> | tar -x
# Logs hold ids only, never matter content; still treat the archive as confidential.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../backup/lib/india-guard.sh
. "$here/../backup/lib/india-guard.sh"

die() { echo "evidence-export: $*" >&2; exit 2; }

from="" to="" out="" query='{service=~".+"}'
while [ $# -gt 0 ]; do
  case "$1" in
    --from) from="${2:-}"; shift 2 ;;
    --to) to="${2:-}"; shift 2 ;;
    --query) query="${2:-}"; shift 2 ;;
    --out) out="${2:-}"; shift 2 ;;
    *) die "unknown argument '$1'" ;;
  esac
done
[ -n "$from" ] && [ -n "$to" ] || die "--from and --to are required (RFC3339, UTC)"
[ -n "${EVIDENCE_KEY_FILE:-}" ] && [ -s "${EVIDENCE_KEY_FILE}" ] || die "EVIDENCE_KEY_FILE must name a non-empty key file"
if [ -n "${EVIDENCE_S3_ENDPOINT:-}" ]; then
  assert_india_endpoint "$EVIDENCE_S3_ENDPOINT" || exit 2
  [ -n "${EVIDENCE_S3_BUCKET:-}" ] || die "EVIDENCE_S3_BUCKET is required with EVIDENCE_S3_ENDPOINT"
fi

id="$(date -u +%Y%m%dT%H%M%SZ)"
out="${out:-./evidence-$id}"
mkdir -p "$out"
work="$(mktemp -d "${TMPDIR:-/tmp}/evidence.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# Pull the range page by page (forward, 5000 entries a page) as NDJSON: {ts, labels, line}.
LOKI_URL="${LOKI_URL:-http://127.0.0.1:3100}" FROM="$from" TO="$to" QUERY="$query" OUTFILE="$work/logs.ndjson" \
  node --input-type=module -e '
import { appendFileSync, writeFileSync } from "node:fs";
const { LOKI_URL, FROM, TO, QUERY, OUTFILE } = process.env;
const ns = (s) => {
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`not a timestamp: ${s}`);
  return BigInt(ms) * 1000000n;
};
const end = ns(TO);
let start = ns(FROM);
const limit = 5000;
let total = 0;
writeFileSync(OUTFILE, "");
for (;;) {
  const url = new URL("/loki/api/v1/query_range", LOKI_URL);
  url.search = new URLSearchParams({ query: QUERY, start: String(start), end: String(end), limit: String(limit), direction: "forward" });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Loki answered ${res.status}`);
  const rows = (await res.json()).data.result.flatMap((s) => s.values.map(([t, line]) => ({ ts: t, labels: s.stream, line })));
  rows.sort((a, b) => (BigInt(a.ts) < BigInt(b.ts) ? -1 : BigInt(a.ts) > BigInt(b.ts) ? 1 : 0));
  if (rows.length > 0) appendFileSync(OUTFILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  total += rows.length;
  if (rows.length < limit) break;
  start = BigInt(rows[rows.length - 1].ts) + 1n;
}
console.error(`evidence-export: ${total} entries`);
' || die "could not read logs from Loki"

printf '%s\n' "{\"from\":\"$from\",\"to\":\"$to\",\"query\":$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$query")}" > "$work/query.json"
entries="$(wc -l < "$work/logs.ndjson" | tr -d ' ')"
tar -C "$work" -cf "$work/evidence.tar" logs.ndjson query.json
sha_logs="$(sha256sum "$work/logs.ndjson" | cut -d' ' -f1)"
sha_query="$(sha256sum "$work/query.json" | cut -d' ' -f1)"

archive="$out/evidence-$id.tar.enc"
openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$EVIDENCE_KEY_FILE" -in "$work/evidence.tar" -out "$archive"
sha_archive="$(sha256sum "$archive" | cut -d' ' -f1)"
printf '%s  %s\n' "$sha_archive" "$(basename "$archive")" > "$archive.sha256"

cat > "$out/evidence-$id.manifest.json" <<JSON
{
  "id": "$id",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "from": "$from",
  "to": "$to",
  "entries": $entries,
  "cipher": "aes-256-cbc-pbkdf2",
  "files": [
    {"name": "logs.ndjson", "sha256": "$sha_logs"},
    {"name": "query.json", "sha256": "$sha_query"}
  ],
  "archive": {"name": "$(basename "$archive")", "sha256": "$sha_archive"}
}
JSON

if [ -n "${EVIDENCE_S3_ENDPOINT:-}" ]; then
  command -v mc >/dev/null || die "mc is required to copy to EVIDENCE_S3_ENDPOINT"
  [ -n "${EVIDENCE_S3_ACCESS_KEY:-}" ] && [ -n "${EVIDENCE_S3_SECRET_KEY:-}" ] || die "EVIDENCE_S3_ACCESS_KEY and EVIDENCE_S3_SECRET_KEY are required"
  MC_HOST_evidence="${EVIDENCE_S3_ENDPOINT%%://*}://${EVIDENCE_S3_ACCESS_KEY}:${EVIDENCE_S3_SECRET_KEY}@${EVIDENCE_S3_ENDPOINT#*://}" mc cp "$archive" "$archive.sha256" "$out/evidence-$id.manifest.json" "evidence/${EVIDENCE_S3_BUCKET}/evidence-$id/" >/dev/null
fi
echo "$archive"
