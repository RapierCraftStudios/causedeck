import { describe, expect, it } from 'vitest';

import { lintFixture, ruleIds } from './eslint-helpers';

describe('dependency boundaries (spike §2)', () => {
  it('fails when packages/ui imports apps/web', async () => {
    const result = await lintFixture('boundaries', 'packages/ui/imports-app.ts');

    expect(ruleIds(result)).toContain('boundaries/element-types');
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('passes when apps/web imports packages/ui', async () => {
    const result = await lintFixture('boundaries', 'apps/web/imports-package.ts');

    expect(result.messages).toEqual([]);
  });

  it('lets core import the packages listed in spike §2', async () => {
    const result = await lintFixture('boundaries', 'packages/core/imports-db.ts');

    expect(result.messages).toEqual([]);
  });

  it('keeps observability free of domain packages', async () => {
    const result = await lintFixture('boundaries', 'packages/observability/imports-db.ts');

    expect(ruleIds(result)).toContain('boundaries/element-types');
  });

  it('lets observability import config', async () => {
    const result = await lintFixture('boundaries', 'packages/observability/imports-config.ts');

    expect(result.messages).toEqual([]);
  });

  it('keeps ui free of domain packages', async () => {
    const result = await lintFixture('boundaries', 'packages/ui/imports-db.ts');

    expect(ruleIds(result)).toContain('boundaries/element-types');
  });
});
