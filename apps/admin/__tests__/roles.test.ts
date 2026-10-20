import { schema } from '@causedeck/db';
import { describe, expect, it } from 'vitest';

import {
  canStaff,
  STAFF_CAPABILITIES,
  STAFF_ROLE_MATRIX,
  STAFF_ROLES,
  STAFF_SESSION_SECONDS,
} from '../lib/roles.ts';

describe('staff role matrix', () => {
  it('has exactly the staff_user roles', () => {
    expect([...STAFF_ROLES]).toEqual([...schema.STAFF_ROLES]);
  });

  it('gives support metadata and sessions, ops adapters and flags, admin everything', () => {
    expect(STAFF_ROLE_MATRIX).toEqual({
      support: ['overview', 'workspaces', 'support', 'audit'],
      ops: ['overview', 'adapters', 'flags', 'audit'],
      admin: STAFF_CAPABILITIES,
    });
    expect(canStaff('support', 'flags')).toBe(false);
    expect(canStaff('support', 'support')).toBe(true);
    expect(canStaff('ops', 'workspaces')).toBe(false);
    expect(canStaff('ops', 'flags')).toBe(true);
    for (const capability of STAFF_CAPABILITIES) expect(canStaff('admin', capability)).toBe(true);
    expect(canStaff('owner' as never, 'overview')).toBe(false);
  });

  it('keeps staff sessions to 8 hours', () => {
    expect(STAFF_SESSION_SECONDS).toBe(28_800);
  });
});
