import * as support from '@causedeck/core/support';
import { describe, expect, it } from 'vitest';

import {
  canStaff,
  DEV_STAFF_EMAIL,
  STAFF_CAPABILITIES,
  STAFF_ROLE_MATRIX,
  STAFF_ROLES,
  STAFF_SESSION_SECONDS,
} from '../lib/roles.ts';

describe('staff role matrix', () => {
  it('has exactly the staff_user roles', () => {
    expect([...STAFF_ROLES]).toEqual([...support.STAFF_ROLES]);
  });

  it('names the same dev staff account as the CLI seed (core/support)', () => {
    // lib/roles.ts stays client-safe (the nav imports it), so it mirrors the core constant.
    expect(DEV_STAFF_EMAIL).toBe(support.DEV_STAFF_EMAIL);
  });

  it('gives support metadata and sessions, ops adapters, sources and flags, admin everything', () => {
    expect(STAFF_ROLE_MATRIX).toEqual({
      support: ['overview', 'workspaces', 'support', 'audit'],
      ops: ['overview', 'adapters', 'sources', 'data-ops', 'flags', 'audit'],
      admin: STAFF_CAPABILITIES,
    });
    expect(canStaff('support', 'flags')).toBe(false);
    expect(canStaff('support', 'support')).toBe(true);
    expect(canStaff('ops', 'workspaces')).toBe(false);
    expect(canStaff('ops', 'flags')).toBe(true);
    expect(canStaff('ops', 'sources')).toBe(true);
    expect(canStaff('support', 'sources')).toBe(false);
    expect(canStaff('ops', 'data-ops')).toBe(true);
    expect(canStaff('support', 'data-ops')).toBe(false);
    expect(canStaff('support', 'business')).toBe(false);
    expect(canStaff('ops', 'business')).toBe(false);
    expect(canStaff('admin', 'business')).toBe(true);
    for (const capability of STAFF_CAPABILITIES) expect(canStaff('admin', capability)).toBe(true);
    expect(canStaff('owner' as never, 'overview')).toBe(false);
  });

  it('keeps staff sessions to 8 hours', () => {
    expect(STAFF_SESSION_SECONDS).toBe(28_800);
  });
});
