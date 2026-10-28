// The registry is data only (#19): a service listed in both lists would hide a missing test, and
// `system.backup.health` (#101) reads only the ops bucket, so it must not appear as a tenant service.
// The registry's two lists must not overlap: an export is either a tested service or not one (#74).
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

  it('lists each core export once and gives every non-service a reason', () => {
    for (const name of Object.keys(NOT_A_SERVICE)) expect(SERVICE_TESTS).not.toHaveProperty(name);
    for (const reason of Object.values(NOT_A_SERVICE)) expect(reason.length).toBeGreaterThan(0);
  });

  it('registers the memory wiring exports (#74)', () => {
    for (const name of ['createBriefMemoryProvider', 'rankWithMemory', 'learnFromCorrection']) {
      expect(name in NOT_A_SERVICE || name in SERVICE_TESTS).toBe(true);
    }
  });
});
