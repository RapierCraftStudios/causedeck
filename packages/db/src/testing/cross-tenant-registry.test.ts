// The registry is data only (#19): a service listed in both lists would hide a missing test, and
// `system.backup.health` (#101) reads only the ops bucket, so it must not appear as a tenant service.
import { describe, expect, it } from 'vitest';

import { NOT_A_SERVICE, SERVICE_TESTS } from './cross-tenant-registry.ts';

describe('cross-tenant registry', () => {
  it('lists no export in both SERVICE_TESTS and NOT_A_SERVICE', () => {
    const both = Object.keys(SERVICE_TESTS).filter((name) => name in NOT_A_SERVICE);
    expect(both).toEqual([]);
  });

  it('has no tenant-service entry for the backup health job', () => {
    expect(Object.keys(SERVICE_TESTS).filter((name) => /backup/i.test(name))).toEqual([]);
  });
});
