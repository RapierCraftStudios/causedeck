import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { createDb, schema, withWorkspace, type Database } from '@causedeck/db';
import { closeTestDb, testAppDb, testDatabaseUrls } from '@causedeck/db/testing';
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

  it('grants audit read to owners and advocates only (#229)', () => {
    for (const role of ['owner', 'advocate'] as const) {
      expect(roles[role].authorize({ audit: ['read'] }).success, role).toBe(true);
    }
    for (const role of ['junior', 'clerk', 'viewer'] as const) {
      expect(roles[role].authorize({ audit: ['read'] }).success, role).toBe(false);
    }
  });
});

describe('roles as Better Auth organization roles', () => {
  const pools: Database[] = [];
  afterAll(async () => {
    for (const pool of pools) await pool.$client.end();
    await closeTestDb();
  });

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

  it('sees no workspace through the organization endpoints with no workspace pinned (#19 RLS)', async () => {
    const { auth } = makeAuth();
    const owner = await devSignInAs(auth, uniqueEmail('owner'));
    const workspaceId = await ownedWorkspace(owner.user.id);
    const listed = await authRequest(auth, '/organization/list', {
      method: 'GET',
      cookie: owner.cookie,
    });
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { id: string }[]).map((w) => w.id)).not.toContain(workspaceId);
  });

  /** A workspace owned by `userId`, written inside its own scope as createWorkspace does. */
  async function ownedWorkspace(userId: string): Promise<string> {
    const id = randomUUID();
    await withWorkspace(testAppDb(), { workspaceId: id }, async (tx) => {
      await tx.insert(schema.organization).values({ id, name: 'Chambers', slug: `chambers-${id}` });
      await tx.insert(schema.member).values({ organizationId: id, userId, role: 'owner' });
    });
    return id;
  }

  /**
   * The apps never call Better Auth's organization endpoints (workspaces live in
   * @causedeck/core/workspaces); under FORCE RLS they only work with a workspace pinned. This pins
   * one on every connection (a startup parameter) so the role guards stay tested at the boundary.
   */
  async function workspaceWithMember() {
    const { auth: global } = makeAuth();
    const owner = await devSignInAs(global, uniqueEmail('owner'));
    const workspaceId = await ownedWorkspace(owner.user.id);
    const url = new URL(testDatabaseUrls().app);
    url.searchParams.set('app.workspace_id', workspaceId);
    const pinned = createDb({ url: new Secret(url.toString()), role: 'app', max: 2 });
    pools.push(pinned);
    const { auth } = makeAuth({ db: pinned });
    const other = await devSignInAs(auth, uniqueEmail('member'));
    return { auth, owner, other, workspaceId };
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
