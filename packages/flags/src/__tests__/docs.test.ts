// docs/engineering/flags.md lists every registered flag and the issues that consume it (#22).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FLAG_KEYS, FLAGS } from '../keys.ts';

const DOC = readFileSync(
  path.resolve(import.meta.dirname, '../../../../docs/engineering/flags.md'),
  'utf8',
);

/** The registry table is the part of the doc before `## Evaluation` (later tables list db tables, not flags). */
const REGISTRY = DOC.split(/^## Evaluation$/m)[0] ?? DOC;

/** The flag table rows: `| \`key\` | ... |`. */
const rows = new Map(
  [...REGISTRY.matchAll(/^\| `([a-z0-9._-]+)` \|(.*)$/gm)].map((m) => [m[1] ?? '', m[2] ?? '']),
);

describe('docs/engineering/flags.md', () => {
  it('documents every registry key with its kill switch and consuming issues', () => {
    for (const key of FLAG_KEYS) {
      const row = rows.get(key);
      expect(row, `${key} is missing from the flags table`).toBeDefined();
      expect(row).toContain(FLAGS[key].killSwitchEnv);
      for (const issue of FLAGS[key].owner) expect(row, key).toContain(`#${String(issue)}`);
      expect(row, key).toContain(FLAGS[key].legalGated ? '⚖' : 'no');
    }
  });

  it('documents no flag that is not registered', () => {
    expect([...rows.keys()].sort()).toEqual([...FLAG_KEYS].sort());
  });
});
