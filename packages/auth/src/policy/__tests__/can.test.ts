import { describe, expect, it } from 'vitest';

import { ROLES } from '../../roles';
import { ALL_ACTIONS, WRITE_ACTIONS, type Action } from '../actions';
import { can, DENY_REASONS, type DenyReason, type Decision } from '../can';
import { actor, matter, OTHER_WS, WS } from './fixtures';

function allowed(decision: Decision): boolean {
  return decision.allow;
}

function reasonOf(decision: Decision): DenyReason | null {
  return decision.allow ? null : decision.reason;
}

describe('can() totality and the matrix', () => {
  it('returns a decision for every (role, action) pair', () => {
    const table: Record<string, Action[]> = {};
    for (const role of ROLES) {
      table[role] = [];
      for (const action of ALL_ACTIONS) {
        const decision = can(actor(role), action);
        expect(typeof decision.allow).toBe('boolean');
        if (!decision.allow) expect(DENY_REASONS).toContain(decision.reason);
        if (decision.allow) table[role].push(action);
      }
    }
    expect(table).toMatchSnapshot();
  });

  it('denies unknown actions by default', () => {
    for (const role of ROLES) {
      expect(can(actor(role), 'matter.nuke' as Action)).toEqual({
        allow: false,
        reason: 'ROLE_DENIED',
      });
    }
  });

  it('does not mutate its inputs', () => {
    const a = Object.freeze(actor('junior', { assignedMatterIds: new Set(['matter-1']) }));
    const r = Object.freeze(matter({ restricted: Object.freeze({ allowUserIds: ['x'] }) }));
    const s = Object.freeze({ advocatesCanInvite: false });
    expect(() => can(a, 'matter.read', r, s)).not.toThrow();
    expect(a).toEqual(actor('junior', { assignedMatterIds: new Set(['matter-1']) }));
  });
});

describe('role rules', () => {
  it('owner can do everything in the workspace', () => {
    for (const action of ALL_ACTIONS) {
      expect(can(actor('owner'), action, matter()), action).toEqual({ allow: true });
    }
  });

  it('advocate has full practice access except billing, deletion and role management', () => {
    const denied = new Set<Action>([
      'billing.manage',
      'billing.read',
      'invoices.read',
      'workspace.delete',
      'workspace.rename',
      'member.remove',
      'member.role',
      'export.run',
    ]);
    for (const action of ALL_ACTIONS) {
      expect(allowed(can(actor('advocate'), action)), action).toBe(!denied.has(action));
    }
    for (const action of denied) {
      expect(reasonOf(can(actor('advocate'), action))).toBe('ROLE_DENIED');
    }
  });

  it('advocate invites by default, not when the workspace turns it off', () => {
    expect(can(actor('advocate'), 'member.invite')).toEqual({ allow: true });
    expect(
      can(actor('advocate'), 'member.invite', undefined, { advocatesCanInvite: true }),
    ).toEqual({ allow: true });
    expect(
      reasonOf(can(actor('advocate'), 'member.invite', undefined, { advocatesCanInvite: false })),
    ).toBe('ROLE_DENIED');
    expect(can(actor('owner'), 'member.invite', undefined, { advocatesCanInvite: false })).toEqual({
      allow: true,
    });
  });

  it('advocate reads the audit log by default, not when the workspace turns it off (#229)', () => {
    expect(can(actor('advocate'), 'audit.read')).toEqual({ allow: true });
    const off = { advocatesCanReadAudit: false };
    expect(reasonOf(can(actor('advocate'), 'audit.read', undefined, off))).toBe('ROLE_DENIED');
    expect(can(actor('owner'), 'audit.read', undefined, off)).toEqual({ allow: true });
    for (const role of ['junior', 'clerk', 'viewer'] as const) {
      expect(reasonOf(can(actor(role), 'audit.read')), role).toBe('ROLE_DENIED');
      expect(
        reasonOf(can(actor(role), 'audit.read', undefined, { advocatesCanReadAudit: true })),
        role,
      ).toBe('ROLE_DENIED');
    }
    // The setting is scoped to audit.read only.
    expect(can(actor('advocate'), 'member.invite', undefined, off)).toEqual({ allow: true });
  });

  it('junior is limited to assigned, shared or own matters', () => {
    const junior = actor('junior', { assignedMatterIds: new Set(['matter-assigned']) });
    expect(can(junior, 'matter.read', matter({ matterId: 'matter-assigned' }))).toEqual({
      allow: true,
    });
    expect(
      can(
        junior,
        'matter.write',
        matter({ matterId: 'matter-shared', restricted: { allowUserIds: [junior.userId] } }),
      ),
    ).toEqual({ allow: true });
    expect(
      can(junior, 'document.read', matter({ matterId: 'matter-own', ownerUserId: junior.userId })),
    ).toEqual({ allow: true });
    expect(reasonOf(can(junior, 'matter.read', matter({ matterId: 'matter-other' })))).toBe(
      'NOT_ASSIGNED',
    );
    expect(reasonOf(can(actor('junior'), 'strategy.read', matter()))).toBe('NOT_ASSIGNED');
    // Advocates are not assignment-scoped.
    expect(can(actor('advocate'), 'matter.read', matter({ matterId: 'matter-other' }))).toEqual({
      allow: true,
    });
  });

  it('viewer is read-only', () => {
    for (const action of WRITE_ACTIONS) {
      expect(reasonOf(can(actor('viewer'), action, matter())), action).toBe('ROLE_DENIED');
    }
    for (const action of ['matter.read', 'document.read', 'task.read', 'listing.read'] as const) {
      expect(can(actor('viewer'), action, matter()), action).toEqual({ allow: true });
    }
  });

  it('clerk reads listings, tasks and documents but not strategy, memory or drafts', () => {
    for (const action of ['listing.read', 'task.read', 'document.read'] as const) {
      expect(can(actor('clerk'), action, matter()), action).toEqual({ allow: true });
    }
    for (const action of ['strategy.read', 'memory.read', 'memory.write', 'draft.write'] as const) {
      expect(reasonOf(can(actor('clerk'), action, matter())), action).toBe('ROLE_DENIED');
    }
  });

  it('shell permissions match the web stub table (apps/web/lib/workspace-context.ts)', () => {
    const stub = {
      owner: ['billing.read', 'invoices.read', 'limitation.read', 'insights.read', 'settings.read'],
      advocate: ['limitation.read', 'insights.read', 'settings.read'],
      junior: ['limitation.read', 'settings.read'],
      clerk: ['settings.read'],
      viewer: [],
    } as const;
    const shell = [
      'billing.read',
      'invoices.read',
      'limitation.read',
      'insights.read',
      'settings.read',
    ] as const;
    for (const role of ROLES) {
      const granted = shell.filter((action) => can(actor(role), action).allow);
      expect(granted, role).toEqual([...stub[role]]);
    }
  });
});

describe('restricted matters', () => {
  const restricted = matter({ restricted: { allowUserIds: ['user-listed'] } });

  it('denies matter.read to users not on the allow list', () => {
    for (const role of ['advocate', 'junior', 'clerk', 'viewer'] as const) {
      expect(reasonOf(can(actor(role), 'matter.read', restricted)), role).toBe('RESTRICTED_MATTER');
    }
  });

  it('allows listed users', () => {
    expect(can(actor('viewer', { userId: 'user-listed' }), 'matter.read', restricted)).toEqual({
      allow: true,
    });
  });

  it('includes owners by default and excludes them when configured', () => {
    expect(can(actor('owner'), 'matter.read', restricted)).toEqual({ allow: true });
    expect(
      reasonOf(
        can(actor('owner'), 'matter.read', restricted, { ownersSeeRestrictedMatters: false }),
      ),
    ).toBe('RESTRICTED_MATTER');
  });
});

describe('cross-workspace', () => {
  it('denies every role with CROSS_WORKSPACE, even suspended or listed actors', () => {
    const foreign = matter({ workspaceId: OTHER_WS, restricted: { allowUserIds: ['user-owner'] } });
    for (const role of ROLES) {
      for (const action of ALL_ACTIONS) {
        expect(reasonOf(can(actor(role), action, foreign))).toBe('CROSS_WORKSPACE');
        expect(reasonOf(can(actor(role, { suspended: true }), action, foreign))).toBe(
          'CROSS_WORKSPACE',
        );
      }
    }
  });
});

describe('deny reasons', () => {
  const cases: Record<DenyReason, () => Decision> = {
    ROLE_DENIED: () => can(actor('viewer'), 'matter.write'),
    RESTRICTED_MATTER: () =>
      can(actor('advocate'), 'matter.read', matter({ restricted: { allowUserIds: [] } })),
    CROSS_WORKSPACE: () => can(actor('owner'), 'matter.read', matter({ workspaceId: OTHER_WS })),
    NOT_ASSIGNED: () => can(actor('junior'), 'matter.read', matter()),
    FEATURE_OFF: () =>
      can(
        actor('owner'),
        'billing.read',
        { kind: 'invoice', workspaceId: WS },
        {
          disabledDomains: new Set(['billing']),
        },
      ),
    SUSPENDED: () => can(actor('owner', { suspended: true }), 'matter.read'),
    STAFF_READ_ONLY: () => can(actor('owner', { kind: 'staff' }), 'matter.write'),
  };

  it.each(DENY_REASONS)('%s is produced by can()', (reason) => {
    expect(cases[reason]()).toEqual({ allow: false, reason });
  });

  it('FEATURE_OFF only switches off the named domain', () => {
    const settings = { disabledDomains: new Set(['billing'] as const) };
    expect(can(actor('owner'), 'matter.read', undefined, settings)).toEqual({ allow: true });
  });
});

describe('staff actors (support sessions, #308)', () => {
  it('denies every write action to staff, whatever the role', () => {
    for (const role of ROLES) {
      for (const action of WRITE_ACTIONS) {
        expect(can(actor(role, { kind: 'staff' }), action)).toEqual({
          allow: false,
          reason: 'STAFF_READ_ONLY',
        });
      }
    }
  });

  it('leaves staff reads to the role and resource rules', () => {
    expect(can(actor('advocate', { kind: 'staff' }), 'matter.read', matter())).toEqual({
      allow: true,
    });
    expect(
      reasonOf(
        can(
          actor('advocate', { kind: 'staff' }),
          'matter.read',
          matter({ restricted: { allowUserIds: [] } }),
        ),
      ),
    ).toBe('RESTRICTED_MATTER');
    expect(
      reasonOf(
        can(actor('owner', { kind: 'staff' }), 'matter.write', matter({ workspaceId: OTHER_WS })),
      ),
    ).toBe('CROSS_WORKSPACE');
  });

  it('treats an actor without kind, or kind user, exactly as before', () => {
    for (const role of ROLES) {
      for (const action of ALL_ACTIONS) {
        expect(can(actor(role, { kind: 'user' }), action)).toEqual(can(actor(role), action));
      }
    }
  });
});
