// Fixture export (#516): writes a workbench bundle (`FixtureBundle` JSON, as the staff console
// downloads it) into `fixtures/<adapter>/`: the input, its expected file and a manifest entry. It
// is the step before the PR: a person commits the files and opens it, so the fixtures are reviewed
// like code. Reads and writes files only: no git, no network. Re-checks the bundle for personal data.
//
//   pnpm --filter @causedeck/adapters fixtures:export <bundle.json> [--root <fixtures dir>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { findPii } from '../workbench/detect.ts';
import { FixtureBundleSchema, type FixtureBundle } from '../workbench/build-fixture.ts';

const DEFAULT_ROOT = path.resolve(import.meta.dirname, '../../fixtures');

/** Write `bundle` under `<root>/<adapterId>/`; returns the files written. */
export function exportBundle(bundle: FixtureBundle, root: string = DEFAULT_ROOT): string[] {
  const parsed = FixtureBundleSchema.parse(bundle);
  if (findPii(`${parsed.inputContent}\n${JSON.stringify(parsed.expected)}`).length > 0) {
    throw new Error('The bundle still holds personal data; rebuild it in the workbench');
  }
  const dir = path.join(root, parsed.adapterId);
  const name = parsed.inputFile.replace(/\.input\.[^.]+$/, '');
  const inputPath = path.join(dir, parsed.inputFile);
  const expectedPath = path.join(dir, `${name}.expected.json`);
  const manifestPath = path.join(dir, 'manifest.json');
  if (existsSync(inputPath) || existsSync(expectedPath)) {
    throw new Error(`${parsed.adapterId}/${parsed.inputFile} already exists`);
  }
  mkdirSync(dir, { recursive: true });
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        fixtures: FixtureBundle['manifestEntry'][];
      })
    : { adapter: parsed.adapterId, classification: 'REDACTED', fixtures: [] };
  manifest.fixtures.push(parsed.manifestEntry);
  writeFileSync(inputPath, parsed.inputContent);
  writeFileSync(expectedPath, `${JSON.stringify(parsed.expected, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return [inputPath, expectedPath, manifestPath];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { root: { type: 'string' } },
  });
  const [file] = positionals;
  if (file === undefined) {
    console.error('usage: fixtures:export <bundle.json> [--root <fixtures dir>]');
    process.exit(2);
  }
  const bundle = FixtureBundleSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  for (const written of exportBundle(bundle, values.root ?? DEFAULT_ROOT)) console.log(written);
}
