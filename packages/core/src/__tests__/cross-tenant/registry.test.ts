// The cross-tenant registry for core services (#19, #209): every runtime export of
// `@causedeck/core` is either registered with a cross-tenant test (SERVICE_TESTS) or listed as not
// a service with a reason (NOT_A_SERVICE). A new export without either fails `pnpm test:tenancy`.
// Once `@causedeck/storage` exports presign (#21), its cross-tenant test must be a real one.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  NOT_A_SERVICE,
  registeredTestFiles,
  SERVICE_TESTS,
  STORAGE_PRESIGN_PLACEHOLDER,
  STORAGE_PRESIGN_TEST,
  staleEntries,
  unregisteredServices,
} from '@causedeck/db/testing/cross-tenant-registry';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const STORAGE_ENTRY = `${REPO_ROOT}packages/storage/src/index.ts`;

async function coreExports(): Promise<string[]> {
  const mod: Record<string, unknown> = await import('@causedeck/core');
  return Object.keys(mod).sort();
}

describe('cross-tenant registry: core services', () => {
  it('registers every runtime export of @causedeck/core', async () => {
    const names = await coreExports();
    expect(names.length).toBeGreaterThan(20);
    expect(
      unregisteredServices(names),
      'core exports without a cross-tenant entry: add them to SERVICE_TESTS or NOT_A_SERVICE',
    ).toEqual([]);
    expect(staleEntries(SERVICE_TESTS, names)).toEqual([]);
    expect(staleEntries(NOT_A_SERVICE, names)).toEqual([]);
    expect(Object.keys(SERVICE_TESTS).filter((name) => name in NOT_A_SERVICE)).toEqual([]);
  });

  it('points only at test files that exist', () => {
    for (const file of registeredTestFiles()) {
      expect(existsSync(`${REPO_ROOT}${file}`), file).toBe(true);
    }
  });

  it('requires a real storage presign test once storage exports presign (#21)', () => {
    const exportsPresign = /export[^;]*presign/i.test(readFileSync(STORAGE_ENTRY, 'utf8'));
    const placeholder = readFileSync(`${REPO_ROOT}${STORAGE_PRESIGN_TEST}`, 'utf8').includes(
      STORAGE_PRESIGN_PLACEHOLDER,
    );
    expect(
      exportsPresign && placeholder,
      `${STORAGE_PRESIGN_TEST} is still the placeholder but @causedeck/storage exports presign`,
    ).toBe(false);
  });

  it('reports an export that has no entry', () => {
    expect(unregisteredServices(['listMembers', 'slugify', 'xtNewService'])).toEqual([
      'xtNewService',
    ]);
  });
});
