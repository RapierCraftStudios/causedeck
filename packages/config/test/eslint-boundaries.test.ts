import { describe, expect, it } from 'vitest';

import {
  CORE_DOMAIN_DEPENDENCIES,
  CORE_DOMAINS,
  findCoreDomainCycle,
} from '../eslint/core-domains.js';
import { lintFixture, ruleIds } from './eslint-helpers';

const CORE_RULE = 'causedeck/core-domain-boundaries';

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

  it('lets core import observability for job spans and logs (#15)', async () => {
    const result = await lintFixture('boundaries', 'packages/core/imports-observability.ts');

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

  it('keeps db free of domain packages (#297)', async () => {
    const result = await lintFixture('boundaries', 'packages/db/imports-billing.ts');

    expect(ruleIds(result)).toContain('boundaries/element-types');
  });

  it('lets db import config', async () => {
    const result = await lintFixture('boundaries', 'packages/db/imports-config.ts');

    expect(result.messages).toEqual([]);
  });

  it('keeps ui free of domain packages', async () => {
    const result = await lintFixture('boundaries', 'packages/ui/imports-db.ts');

    expect(ruleIds(result)).toContain('boundaries/element-types');
  });
});

describe('app → db boundary (#299)', () => {
  const RESTRICTED = '@typescript-eslint/no-restricted-imports';

  it('fails an app value import of @causedeck/db', async () => {
    const result = await lintFixture('boundaries', 'apps/api/src/imports-db-value.ts');

    expect(ruleIds(result)).toContain(RESTRICTED);
    expect(result.messages[0]?.message).toContain('@causedeck/core');
  });

  it('passes an app `import type` from @causedeck/db', async () => {
    const result = await lintFixture('boundaries', 'apps/api/src/imports-db-type.ts');

    expect(result.messages).toEqual([]);
  });

  it('fails @causedeck/db/testing outside a test file', async () => {
    const result = await lintFixture('boundaries', 'apps/api/src/imports-db-testing.ts');

    expect(ruleIds(result)).toContain(RESTRICTED);
  });

  it('passes @causedeck/db/testing, testing/* and seed/* in an app test file', async () => {
    const result = await lintFixture(
      'boundaries',
      'apps/api/src/__tests__/imports-db-testing.test.ts',
    );

    expect(result.messages).toEqual([]);
  });

  it('fails a root @causedeck/db value import in an app test file', async () => {
    const result = await lintFixture(
      'boundaries',
      'apps/api/src/__tests__/imports-db-root.test.ts',
    );

    expect(ruleIds(result)).toContain(RESTRICTED);
    expect(result.messages[0]?.message).toContain('@causedeck/db/testing');
  });

  it('applies to apps/admin, whose withoutWorkspace exemption is its data layer only (#309)', async () => {
    const banned = await lintFixture('boundaries', 'apps/admin/src/imports-db-value.ts');
    expect(ruleIds(banned)).toContain(RESTRICTED);

    const outside = await lintFixture('boundaries', 'apps/admin/src/imports-without-workspace.ts');
    expect(outside.messages.map((m) => m.message).join('\n')).toContain(
      'the apps/admin data layer',
    );

    const exempt = await lintFixture(
      'boundaries',
      'apps/admin/lib/data/imports-without-workspace.ts',
    );
    expect(exempt.messages).toEqual([]);

    const dataLayerDb = await lintFixture('boundaries', 'apps/admin/lib/data/imports-db-value.ts');
    expect(ruleIds(dataLayerDb)).toContain(RESTRICTED);
  });
});

describe('core domain boundaries (#293)', () => {
  it('fails a deep import into another domain', async () => {
    const result = await lintFixture(
      'boundaries',
      'packages/core/src/usage/imports-billing-internal.ts',
    );

    expect(ruleIds(result)).toContain(CORE_RULE);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('passes an import through the domain index.ts', async () => {
    const result = await lintFixture(
      'boundaries',
      'packages/core/src/usage/imports-billing-index.ts',
    );

    expect(result.messages).toEqual([]);
  });

  it('fails an import of a domain the map does not declare', async () => {
    const result = await lintFixture(
      'boundaries',
      'packages/core/src/audit/imports-billing-index.ts',
    );

    expect(ruleIds(result)).toContain(CORE_RULE);
  });

  it('fails when shared/ imports a domain', async () => {
    const result = await lintFixture('boundaries', 'packages/core/src/shared/imports-domain.ts');

    expect(ruleIds(result)).toContain(CORE_RULE);
  });
});

describe('core domain dependency map (#293)', () => {
  it('has no cycle', () => {
    expect(findCoreDomainCycle(CORE_DOMAIN_DEPENDENCIES)).toBeNull();
  });

  it('detects a cycle', () => {
    expect(findCoreDomainCycle({ a: ['b'], b: ['a'] })).toEqual(['a', 'b', 'a']);
  });

  it('names only declared domains as dependencies', () => {
    for (const dependencies of Object.values(CORE_DOMAIN_DEPENDENCIES)) {
      for (const dependency of dependencies) expect(CORE_DOMAINS).toContain(dependency);
    }
  });

  it('keeps shared free of domain dependencies', () => {
    expect(CORE_DOMAIN_DEPENDENCIES.shared).toEqual([]);
  });
});
