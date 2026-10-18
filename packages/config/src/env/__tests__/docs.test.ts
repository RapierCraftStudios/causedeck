import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { envRegistry } from '../schema.ts';

const doc = readFileSync(
  path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'docs', 'engineering', 'env.md'),
  'utf8',
);
/** The key table lives under `## Keys`. */
const keysSection = doc.slice(doc.indexOf('## Keys'));

/** The table row for a key: the line starting with `| \`KEY\` |`. */
function row(name: string): string | undefined {
  return keysSection.split('\n').find((line) => line.startsWith(`| \`${name}\` |`));
}

describe('docs/engineering/env.md', () => {
  it('has a key table', () => {
    expect(doc).toContain('## Keys');
  });

  it.each(envRegistry.map((spec) => [spec.name, spec]))('has a row for %s', (name, spec) => {
    const line = row(name);

    expect(line, `missing row for ${name}`).toBeDefined();
    expect(line).toContain(`#${String(spec.ownerIssue)}`);
    if (spec.credentialIssue !== undefined) {
      expect(line).toContain(`#${String(spec.credentialIssue)}`);
    }
  });

  it('points Google OAuth credentials at #109', () => {
    expect(row('GOOGLE_CLIENT_ID')).toContain('#109');
    expect(row('GOOGLE_CLIENT_SECRET')).toContain('#109');
  });

  it('documents no keys the schema does not define', () => {
    const documented = [...keysSection.matchAll(/^\| `([A-Z0-9_*]+)` \|/gm)].map((m) => m[1]);

    expect(documented.sort()).toEqual(envRegistry.map((spec) => spec.name).sort());
  });
});
