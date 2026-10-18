import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { base } from '../eslint/base.js';
import { fixturesDir, lintFixture, ruleIds } from './eslint-helpers';

describe('type-safety and import rules', () => {
  it('reports `any` in an exported signature', async () => {
    const result = await lintFixture('rules', 'packages/core/explicit-any.ts');

    expect(ruleIds(result)).toContain('@typescript-eslint/no-explicit-any');
  });

  it('forbids deep imports into another package', async () => {
    const result = await lintFixture('rules', 'packages/core/deep-import.ts');

    expect(ruleIds(result)).toContain('no-restricted-imports');
  });

  it('forbids packages from importing apps by workspace name', async () => {
    const result = await lintFixture('rules', 'packages/core/imports-app-by-name.ts');

    expect(result.messages.map((m) => m.message).join('\n')).toContain(
      'Packages must not import apps',
    );
  });

  it('accepts clean code', async () => {
    const result = await lintFixture('rules', 'packages/core/clean.ts');

    expect(result.messages).toEqual([]);
  });

  it('enables no-explicit-any and every no-unsafe-* rule as errors', async () => {
    const cwd = path.join(fixturesDir, 'rules');
    const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: base });
    const config = (await eslint.calculateConfigForFile(
      path.join(cwd, 'packages/core/clean.ts'),
    )) as { rules: Record<string, unknown[]> };

    const unsafeRules = [
      'no-explicit-any',
      'no-unsafe-argument',
      'no-unsafe-assignment',
      'no-unsafe-call',
      'no-unsafe-declaration-merging',
      'no-unsafe-enum-comparison',
      'no-unsafe-function-type',
      'no-unsafe-member-access',
      'no-unsafe-return',
      'no-unsafe-unary-minus',
    ];
    for (const rule of unsafeRules) {
      // ESLint normalises severities to numbers: 2 = error.
      expect(config.rules[`@typescript-eslint/${rule}`]?.[0], rule).toBe(2);
    }
  });
});
