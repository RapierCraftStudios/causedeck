// Lighthouse CI only: write a fresh, validly signed `out/status/status.json` into the static
// export so `/status/` (which fetches it in the browser) renders its real operational state.
// Run by the site lighthouse job on its downloaded copy of the export, never by `build`, so the
// file is not part of what ships. Signed like core signs it: HMAC-SHA256 over canonical JSON.
// Uses the public dev key, the build default (the lighthouse job builds with no override).
//   tsx scripts/write-lhci-status.ts [outDir]
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEV_STATUS_VERIFY_KEY } from '../lib/env.ts';
import { canonicalJson } from '../lib/status/verify.ts';

/** A signed, all-operational snapshot generated `now` (it goes stale after 300 s). */
export function lhciSnapshot(now: Date, key: string): Record<string, unknown> {
  const unsigned = {
    version: 1,
    generatedAt: now.toISOString(),
    overall: 'operational',
    components: [
      { id: 'database', name: 'Database', status: 'operational' },
      { id: 'storage', name: 'Storage', status: 'operational' },
      { id: 'court', name: 'Court', status: 'operational' },
    ],
    incidents: [],
  };
  const value = createHmac('sha256', key).update(canonicalJson(unsigned)).digest('hex');
  return { ...unsigned, signature: { alg: 'HS256', value } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = path.resolve(process.argv[2] ?? 'out');
  mkdirSync(path.join(outDir, 'status'), { recursive: true });
  const file = path.join(outDir, 'status', 'status.json');
  writeFileSync(file, JSON.stringify(lhciSnapshot(new Date(), DEV_STATUS_VERIFY_KEY)));
  console.log(`wrote ${file}`);
}
