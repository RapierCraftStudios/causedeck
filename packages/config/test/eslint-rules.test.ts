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

  it('bans logging request bodies and matter content', async () => {
    const result = await lintFixture('rules', 'packages/observability/logs-body.ts');
    const restricted = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');

    expect(restricted.map((m) => m.line)).toEqual([10, 11, 12, 13]);
    expect(restricted[0]?.message).toContain('Do not log request bodies or matter content');
  });

  it('allows logging ids and lengths', async () => {
    const result = await lintFixture('rules', 'packages/observability/logs-ids.ts');

    expect(ruleIds(result)).not.toContain('no-restricted-syntax');
  });

  it('bans importing withoutWorkspace outside packages/db, the admin data layer and migrations', async () => {
    const banned = await lintFixture('rules', 'apps/web/imports-without-workspace.ts');
    // The app→db value ban (#299) also reports this line; this test is about withoutWorkspace.
    const restricted = banned.messages.filter(
      (m) =>
        m.ruleId === '@typescript-eslint/no-restricted-imports' &&
        m.message.includes('withoutWorkspace'),
    );
    expect(restricted.map((m) => m.line)).toEqual([1]);
    expect(restricted[0]?.message).toContain('`withoutWorkspace` is for packages/db');

    const allowed = await lintFixture('rules', 'packages/db/imports-without-workspace.ts');
    expect(ruleIds(allowed)).not.toContain('@typescript-eslint/no-restricted-imports');

    const scoped = await lintFixture('rules', 'packages/core/imports-with-workspace.ts');
    expect(ruleIds(scoped)).not.toContain('@typescript-eslint/no-restricted-imports');
  });

  it('allows withoutWorkspace in apps/admin only inside its audited data layer (#309)', async () => {
    const dataLayer = await lintFixture(
      'rules',
      'apps/admin/lib/data/imports-without-workspace.ts',
    );
    expect(ruleIds(dataLayer)).not.toContain('@typescript-eslint/no-restricted-imports');

    const outside = await lintFixture('rules', 'apps/admin/app/imports-without-workspace.ts');
    // The app→db value ban (#299) also reports this line; this test is about withoutWorkspace.
    const restricted = outside.messages.filter(
      (m) =>
        m.ruleId === '@typescript-eslint/no-restricted-imports' &&
        m.message.includes('withoutWorkspace'),
    );
    expect(restricted.map((m) => m.line)).toEqual([1]);
    expect(restricted[0]?.message).toContain('the apps/admin data layer');
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
