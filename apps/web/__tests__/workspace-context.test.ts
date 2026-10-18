import { describe, expect, it } from 'vitest';

import { can, DEV_USER_ID, getWorkspaceContext, type Role } from '../lib/workspace-context.ts';

describe('getWorkspaceContext (dev stub)', () => {
  it('returns the workspace, role and memberships for a member', async () => {
    const context = await getWorkspaceContext('demo');
    expect(context?.workspace.slug).toBe('demo');
    expect(context?.role).toBe('owner');
    expect(context?.memberships.map((m) => [m.workspace.slug, m.role])).toEqual([
      ['demo', 'owner'],
      ['clerk-desk', 'clerk'],
    ]);
  });

  it('returns the role for the requested workspace', async () => {
    expect((await getWorkspaceContext('clerk-desk'))?.role).toBe('clerk');
  });

  it('returns null for a workspace the user is not a member of', async () => {
    expect(await getWorkspaceContext('other-chambers')).toBeNull();
    expect(await getWorkspaceContext('other-chambers', { userId: DEV_USER_ID })).toBeNull();
  });

  it('returns null for unknown slugs and unknown users', async () => {
    expect(await getWorkspaceContext('nope')).toBeNull();
    expect(await getWorkspaceContext('demo', { userId: 'stranger' })).toBeNull();
  });

  it('never lists workspaces the user does not belong to', async () => {
    const context = await getWorkspaceContext('other-chambers', { userId: 'someone-else' });
    expect(context?.memberships.map((m) => m.workspace.slug)).toEqual(['other-chambers']);
  });
});

describe('can (local role table)', () => {
  it('lets the owner do everything the shell gates on', () => {
    for (const permission of [
      'billing.read',
      'invoices.read',
      'limitation.read',
      'insights.read',
      'settings.read',
    ] as const) {
      expect(can('owner', permission)).toBe(true);
    }
  });

  it('denies billing to clerk and viewer, and everything to viewer', () => {
    expect(can('clerk', 'billing.read')).toBe(false);
    const roles: Role[] = ['viewer'];
    for (const role of roles) expect(can(role, 'settings.read')).toBe(false);
  });
});
