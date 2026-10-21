import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { checkCoreImport, coreDomainBoundaries } from '../eslint/rules/core-domain-boundaries.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: 'module' },
});

const SRC = 'packages/core/src';
const at = (file: string, code: string) => ({ code, filename: `${SRC}/${file}` });
const bad = (file: string, code: string, messageId: string) => ({
  ...at(file, code),
  errors: [{ messageId }],
});

ruleTester.run('causedeck/core-domain-boundaries', coreDomainBoundaries, {
  valid: [
    // Through the target domain's entry point, in every accepted form.
    at('usage/limits.ts', `import { x } from '../billing/index.ts';`),
    at('court/forums.ts', `import { x } from '../workspaces/index.ts';`),
    at('usage/limits.ts', `import { x } from '../billing/index';`),
    at('usage/limits.ts', `import { x } from '../billing/index.js';`),
    at('usage/limits.ts', `import { x } from '../billing';`),
    at('usage/limits.ts', `import type { X } from '../audit/index.ts';`),
    at('jobs/definitions/usage-rollup.ts', `import { x } from '../../usage/index.ts';`),
    at('jobs/index.ts', `export * from '../billing/index.ts';`),
    at('jobs/define.ts', `const m = import('../audit/index.ts');`),
    // Same domain, shared/, and package specifiers are out of scope.
    at('billing/entitlements.ts', `import { x } from './internal/plan.ts';`),
    at('jobs/definitions/a.ts', `import { x } from '../define.ts';`),
    at('audit/query.ts', `import { notFound } from '../shared/errors.ts';`),
    at('shared/errors.ts', `import { y } from './membership.ts';`),
    at('audit/sink.ts', `import { db } from '@causedeck/db';`),
    // Tests may import any domain, but only through its index.ts.
    at('audit/__tests__/query.test.ts', `import { x } from '../../billing/index.ts';`),
    at('audit/chain.test.ts', `import { x } from '../jobs/index.ts';`),
    at('audit/__tests__/query.test.ts', `import { seed } from '../../__tests__/fixtures.ts';`),
    // Root files reach domains through their index.ts.
    at('index.ts', `export * from './workspaces/index.ts';`),
    at('__tests__/cross-tenant/services.test.ts', `import * as core from '../../index.ts';`),
    at('__tests__/fixtures.ts', `import { record } from '../audit/index.ts';`),
    // Files outside packages/core/src are ignored.
    { code: `import { x } from '../billing/internal.ts';`, filename: 'packages/db/src/usage/a.ts' },
  ],
  invalid: [
    bad('usage/limits.ts', `import { x } from '../billing/entitlements.ts';`, 'deepImport'),
    bad('usage/limits.ts', `import type { X } from '../billing/entitlements.ts';`, 'deepImport'),
    bad('jobs/index.ts', `export * from '../billing/invoices.ts';`, 'deepImport'),
    bad('jobs/index.ts', `export { x } from '../usage/rollup.ts';`, 'deepImport'),
    bad('jobs/define.ts', `const m = import('../audit/sink.ts');`, 'deepImport'),
    bad(
      'jobs/definitions/billing-dunning-tick.ts',
      `import { x } from '../../billing/x.ts';`,
      'deepImport',
    ),
    bad(
      'usage/__tests__/budget.test.ts',
      `import { x } from '../../billing/entitlements.ts';`,
      'deepImport',
    ),
    bad('index.ts', `export * from './billing/entitlements.ts';`, 'deepImport'),
    bad('__tests__/fixtures.ts', `import { x } from '../audit/writer.ts';`, 'deepImport'),
    bad('index.test.ts', `import { x } from './jobs/define.ts';`, 'deepImport'),
    bad('audit/sink.ts', `import { x } from '../workspaces/index.ts';`, 'undeclaredDependency'),
    bad('billing/plans.ts', `import { x } from '../usage/index.ts';`, 'undeclaredDependency'),
    bad('shared/errors.ts', `import { x } from '../workspaces/index.ts';`, 'sharedImportsDomain'),
    bad('shared/errors.ts', `import { x } from '../audit/writer.ts';`, 'sharedImportsDomain'),
    // `court` is a declared domain since #34, so the unknown-domain cases use an undeclared folder.
    bad('briefs/graph.ts', `import { x } from '../audit/index.ts';`, 'unknownDomain'),
    bad('audit/sink.ts', `import { x } from '../briefs/index.ts';`, 'unknownDomain'),
    bad('court/forums.ts', `import { x } from '../audit/index.ts';`, 'undeclaredDependency'),
  ],
});

describe('checkCoreImport', () => {
  it('lets a test import an undeclared domain through its index only', () => {
    const file = `${SRC}/audit/helper.ts`;

    expect(checkCoreImport(file, '../billing/index.ts', { isTest: true })).toBeNull();
    expect(checkCoreImport(file, '../billing/index.ts', { isTest: false })).toBe(
      'undeclaredDependency',
    );
    expect(checkCoreImport(file, '../billing/plans.ts', { isTest: true })).toBe('deepImport');
  });

  it('ignores package specifiers and non-core files', () => {
    expect(checkCoreImport(`${SRC}/audit/a.ts`, '@causedeck/billing')).toBeNull();
    expect(checkCoreImport('packages/db/src/a.ts', '../billing/x.ts')).toBeNull();
  });
});
