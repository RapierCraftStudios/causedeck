// The pinned corpus sample: a sha256 per committed fixture file. A changed file without a changed
// manifest fails the eval, so the baseline always refers to the same data.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILES = ['corpus.json', 'queries.json'] as const;

export type Manifest = Record<string, string>;

export const sha256 = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

export function buildManifest(dir: string): Manifest {
  return Object.fromEntries(
    MANIFEST_FILES.map((file) => [file, sha256(readFileSync(path.join(dir, file)))]),
  );
}

/** One message per file whose hash differs from, or is missing in, the pinned manifest. */
export function manifestDrift(dir: string, pinned: Manifest): string[] {
  const actual = buildManifest(dir);
  return MANIFEST_FILES.flatMap((file) =>
    pinned[file] === actual[file]
      ? []
      : [`${file}: pinned ${pinned[file] ?? 'nothing'}, found ${actual[file] ?? 'nothing'}`],
  );
}
