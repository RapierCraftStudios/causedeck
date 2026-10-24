// The cross-tenant registry for notifications services (#194, #19): every runtime export of
// `@causedeck/notifications` is either registered with a cross-tenant test
// (NOTIFICATION_SERVICE_TESTS) or listed as not a service with a reason. A new export without
// either fails `pnpm test:tenancy`.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  NOTIFICATION_NOT_A_SERVICE,
  NOTIFICATION_SERVICE_TESTS,
  registeredTestFiles,
  staleEntries,
  unregisteredServices,
} from '@causedeck/db/testing/cross-tenant-registry';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

describe('cross-tenant registry: notifications services', () => {
  it('registers every runtime export of @causedeck/notifications', async () => {
    const mod: Record<string, unknown> = await import('../../index.ts');
    const names = Object.keys(mod).sort();
    expect(
      unregisteredServices(names, NOTIFICATION_SERVICE_TESTS, NOTIFICATION_NOT_A_SERVICE),
      'exports without a cross-tenant entry: add them to NOTIFICATION_SERVICE_TESTS or NOTIFICATION_NOT_A_SERVICE',
    ).toEqual([]);
    expect(staleEntries(NOTIFICATION_SERVICE_TESTS, names)).toEqual([]);
    expect(staleEntries(NOTIFICATION_NOT_A_SERVICE, names)).toEqual([]);
    expect(
      Object.keys(NOTIFICATION_SERVICE_TESTS).filter((n) => n in NOTIFICATION_NOT_A_SERVICE),
    ).toEqual([]);
  });

  it('points only at test files that exist', () => {
    for (const file of registeredTestFiles()) {
      expect(existsSync(`${REPO_ROOT}${file}`), file).toBe(true);
    }
  });

  it('reports an export that has no entry', () => {
    expect(
      unregisteredServices(
        ['notify', 'CATEGORIES', 'sendEmailTo'],
        NOTIFICATION_SERVICE_TESTS,
        NOTIFICATION_NOT_A_SERVICE,
      ),
    ).toEqual(['sendEmailTo']);
  });
});
