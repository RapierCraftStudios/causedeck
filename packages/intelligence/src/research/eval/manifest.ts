// The pinned corpus sample: a sha256 per committed fixture file. A changed file without a changed
// manifest fails the eval, so the baseline always refers to the same data.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILES: readonly string[] = ['corpus.json', 'queries.json', 'answers.json'];

export type Manifest = Record<string, string>;

export const sha256 = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

/** A sha256 per file of `files` that exists in `dir`; a missing file is left out (drift reports it). */
export function buildManifest(dir: string, files: readonly string[] = MANIFEST_FILES): Manifest {
  return Object.fromEntries(
    files
      .filter((file) => existsSync(path.join(dir, file)))
      .map((file) => [file, sha256(readFileSync(path.join(dir, file)))]),
  );
}

/** One message per file whose hash differs from, or is missing in, the pinned manifest. */
export function manifestDrift(
  dir: string,
  pinned: Manifest,
  files: readonly string[] = MANIFEST_FILES,
): string[] {
  const actual = buildManifest(dir, files);
  return files.flatMap((file) =>
    pinned[file] === actual[file]
      ? []
      : [`${file}: pinned ${pinned[file] ?? 'nothing'}, found ${actual[file] ?? 'nothing'}`],
  );
}
