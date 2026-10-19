// Static checks on the core domain layout (#293, docs/engineering/core-domains.md). No database.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CORE_DOMAIN_DEPENDENCIES,
  CORE_DOMAINS,
  findCoreDomainCycle,
} from '@causedeck/config/eslint/core-domains';
import { checkCoreImport } from '@causedeck/config/eslint/rules/core-domain-boundaries';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;
const SPECIFIER = /\b(?:from|import)\s*\(?\s*'(\.[^']*)'/g;

const topLevelFolders = readdirSync(SRC, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
  .map((entry) => entry.name);

const sourceFiles = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.ts'))
  .map((file) => path.join(SRC, file));

describe('@causedeck/core domains', () => {
  it('gives every domain folder a public index.ts', () => {
    for (const folder of topLevelFolders) {
      expect(readdirSync(path.join(SRC, folder)), folder).toContain('index.ts');
    }
  });

  it('declares exactly the folders under src/ in the dependency map', () => {
    expect([...topLevelFolders].sort()).toEqual([...CORE_DOMAINS].sort());
  });

  it('re-exports only domain entry points from the root index', () => {
    const root = readFileSync(path.join(SRC, 'index.ts'), 'utf8');
    const targets = [...root.matchAll(/^export\s[^;]*?\sfrom\s+'([^']+)'/gm)].map((m) => m[1]);

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target).toMatch(/^\.\/[a-z-]+\/index\.ts$/);
      expect(target).not.toMatch(/^\.\/(billing|shared)\//);
    }
  });

  it('imports other domains only through their index.ts and along declared edges', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      for (const [, specifier] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        if (specifier === undefined) continue;
        const problem = checkCoreImport(file, specifier);
        if (problem) violations.push(`${path.relative(SRC, file)}: ${specifier} (${problem})`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('has no cycle in the dependency map', () => {
    expect(findCoreDomainCycle(CORE_DOMAIN_DEPENDENCIES)).toBeNull();
  });
});
