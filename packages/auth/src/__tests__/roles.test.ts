import { randomUUID } from 'node:crypto';

import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { atLeast, isRole, ROLES, roles } from '../roles';
import { authRequest, devSignInAs, makeAuth, uniqueEmail } from './helpers';

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

describe('roles as Better Auth organization roles', () => {
  afterAll(closeTestDb);

  it('matches the role list the database CHECK constraints use', async () => {
    for (const name of ['member_role_chk', 'invitation_role_chk']) {
      const [row] = await testAppDb().execute<{ def: string }>(
        sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${name}`,
      );
      const allowed = [...(row?.def ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
      expect(allowed, name).toEqual([...ROLES]);
    }
  });

  it('configures the organization plugin with these roles and owner as creator', () => {
    const { auth } = makeAuth();
    const plugin = auth.options.plugins.find((p) => p.id === 'organization') as unknown as {
      options: { roles: unknown; creatorRole: string };
    };
    expect(plugin.options.roles).toBe(roles);
    expect(plugin.options.creatorRole).toBe('owner');
  });

  async function workspaceWithMember() {
    const { auth } = makeAuth();
    const owner = await devSignInAs(auth, uniqueEmail('owner'));
    const created = await authRequest(auth, '/organization/create', {
      cookie: owner.cookie,
      body: { name: 'Chambers', slug: `chambers-${randomUUID()}` },
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string; members: { role: string }[] };
    expect(workspace.members[0]?.role).toBe('owner');
    const other = await devSignInAs(auth, uniqueEmail('member'));
    return { auth, owner, other, workspaceId: workspace.id };
  }

  it('rejects an unknown role at the API boundary and accepts a known one', async () => {
    const { auth, owner, other, workspaceId } = await workspaceWithMember();

    for (const role of ['admin', 'member', 'owner,admin', '']) {
      const invite = await authRequest(auth, '/organization/invite-member', {
        cookie: owner.cookie,
        body: { email: uniqueEmail('invitee'), role, organizationId: workspaceId },
      });
      expect(invite.status, `invite ${role}`).toBe(400);
      expect(await invite.json()).toMatchObject({ code: 'ROLE_NOT_FOUND' });

      await expect(
        auth.api.addMember({
          body: { userId: other.user.id, role: role as never, organizationId: workspaceId },
        }),
        `addMember ${role}`,
      ).rejects.toMatchObject({ status: 'BAD_REQUEST' });
    }

    const added = await auth.api.addMember({
      body: { userId: other.user.id, role: 'junior', organizationId: workspaceId },
    });
    expect(added.role).toBe('junior');

    const update = await authRequest(auth, '/organization/update-member-role', {
      cookie: owner.cookie,
      body: { memberId: added.id, role: 'admin', organizationId: workspaceId },
    });
    expect(update.status).toBe(400);
    const promoted = await authRequest(auth, '/organization/update-member-role', {
      cookie: owner.cookie,
      body: { memberId: added.id, role: 'advocate', organizationId: workspaceId },
    });
    expect(promoted.status).toBe(200);
  });
});
