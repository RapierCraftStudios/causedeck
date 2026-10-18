import { describe, expect, it } from 'vitest';

import { atLeast, isRole, ROLES, roles } from './roles';

describe('ROLES', () => {
  it('lists the five workspace roles, most privileged first', () => {
    expect(ROLES).toEqual(['owner', 'advocate', 'junior', 'clerk', 'viewer']);
  });

  it('isRole accepts only known roles', () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    for (const value of ['admin', 'member', '', 'Owner', null, 1])
      expect(isRole(value)).toBe(false);
  });
});

describe('atLeast', () => {
  it('follows owner > advocate > junior > clerk > viewer', () => {
    for (const [i, role] of ROLES.entries()) {
      for (const [j, minimum] of ROLES.entries()) {
        expect(atLeast(role, minimum), `${role} >= ${minimum}`).toBe(i <= j);
      }
    }
  });
});

describe('roles (Better Auth access control)', () => {
  it('has exactly one access-control role per ROLE', () => {
    expect(Object.keys(roles).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) expect(typeof roles[role].authorize).toBe('function');
  });

  it('lets only the owner delete the organization', () => {
    expect(roles.owner.authorize({ organization: ['delete'] }).success).toBe(true);
    for (const role of ['advocate', 'junior', 'clerk', 'viewer'] as const) {
      expect(roles[role].authorize({ organization: ['delete'] }).success).toBe(false);
    }
  });

  it('keeps the viewer read-only', () => {
    expect(roles.viewer.authorize({ matter: ['read'] }).success).toBe(true);
    expect(roles.viewer.authorize({ matter: ['update'] }).success).toBe(false);
    expect(roles.viewer.authorize({ member: ['create'] }).success).toBe(false);
  });
});
