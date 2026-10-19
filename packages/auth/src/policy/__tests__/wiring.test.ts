// Helpers the apps wire the policy through (#234): role-only decisions, invitable roles, the
// NOT_FOUND concealment rule and the cross-copy ForbiddenError check.
import { describe, expect, it } from 'vitest';

import { ROLES } from '../../role-rank';
import * as roles from '../../roles';
import { ALL_ACTIONS } from '../actions';
import { assertCan, conceals, ForbiddenError, isForbiddenError } from '../assert';
import { can, invitableRoles, roleCan } from '../can';
import { MATRIX } from '../matrix';
import { actor, matter, OTHER_WS } from './fixtures';

const silent = { logger: { warn: () => undefined } };

describe('roleCan', () => {
  it('agrees with resource-less can() for every (role, action) pair', () => {
    for (const role of ROLES) {
      for (const action of ALL_ACTIONS) {
        expect(roleCan(role, action)).toBe(can(actor(role), action).allow);
      }
    }
  });

  it('honours workspace settings', () => {
    expect(roleCan('advocate', 'member.invite')).toBe(true);
    expect(roleCan('advocate', 'member.invite', { advocatesCanInvite: false })).toBe(false);
  });

  it('keeps role changes, ownership transfer and slug rename owner-only', () => {
    expect(MATRIX['member.role']).toBe('owner');
    expect(MATRIX['workspace.rename']).toBe('owner');
    expect(ROLES.filter((role) => roleCan(role, 'member.role'))).toEqual(['owner']);
    expect(ROLES.filter((role) => roleCan(role, 'workspace.rename'))).toEqual(['owner']);
  });
});

describe('invitableRoles', () => {
  it('owners invite advocate..viewer, advocates junior..viewer, others nobody', () => {
    expect(invitableRoles('owner')).toEqual(['advocate', 'junior', 'clerk', 'viewer']);
    expect(invitableRoles('advocate')).toEqual(['junior', 'clerk', 'viewer']);
    expect(invitableRoles('junior')).toEqual([]);
    expect(invitableRoles('clerk')).toEqual([]);
    expect(invitableRoles('viewer')).toEqual([]);
  });

  it('is empty for advocates when the workspace turns advocate invites off', () => {
    expect(invitableRoles('advocate', { advocatesCanInvite: false })).toEqual([]);
  });
});

describe('conceals and isForbiddenError', () => {
  function denial(fn: () => void): ForbiddenError {
    try {
      fn();
    } catch (error) {
      if (error instanceof ForbiddenError) return error;
    }
    throw new Error('expected a ForbiddenError');
  }

  it('conceals resource-level read denials only', () => {
    const restricted = matter({ restricted: { allowUserIds: [] } });
    expect(
      conceals(
        denial(() => {
          assertCan(actor('advocate'), 'matter.read', restricted, silent);
        }),
      ),
    ).toBe(true);
    expect(
      conceals(
        denial(() => {
          assertCan(actor('owner'), 'matter.read', matter({ workspaceId: OTHER_WS }), silent);
        }),
      ),
    ).toBe(true);
    expect(
      conceals(
        denial(() => {
          assertCan(
            actor('junior', { assignedMatterIds: new Set() }),
            'matter.read',
            matter(),
            silent,
          );
        }),
      ),
    ).toBe(true);
    // Writes and role denials stay FORBIDDEN.
    expect(
      conceals(
        denial(() => {
          assertCan(actor('advocate'), 'matter.write', restricted, silent);
        }),
      ),
    ).toBe(false);
    expect(
      conceals(
        denial(() => {
          assertCan(actor('advocate'), 'billing.read', undefined, silent);
        }),
      ),
    ).toBe(false);
  });

  it('matches ForbiddenError instances and same-shaped copies, nothing else', () => {
    expect(isForbiddenError(new ForbiddenError('member.role', 'ROLE_DENIED'))).toBe(true);
    const copy = Object.assign(new Error('x'), {
      name: 'ForbiddenError',
      code: 'FORBIDDEN',
      action: 'member.role',
      reason: 'ROLE_DENIED',
    });
    expect(isForbiddenError(copy)).toBe(true);
    const workspaceError = Object.assign(new Error('x'), {
      name: 'WorkspaceError',
      code: 'FORBIDDEN',
    });
    expect(isForbiddenError(workspaceError)).toBe(false);
    expect(isForbiddenError('FORBIDDEN')).toBe(false);
  });
});

describe('role-rank', () => {
  it('roles.ts re-exports the same role list and helpers', () => {
    expect(roles.ROLES).toBe(ROLES);
  });
});
