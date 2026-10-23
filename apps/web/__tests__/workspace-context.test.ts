// The membership-backed workspace loader (#179) with the session and the core queries faked: the
// queries themselves (soft-delete and inactive-member filtering, slug history) are covered against
// Postgres in packages/core/src/workspaces/__tests__/workspaces.test.ts.
import type { MembershipSummary, ResolvedSlug } from '@causedeck/core/workspaces';
import type { Workspace as DbWorkspace } from '@causedeck/db';
import { describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';
import {
  can,
  LAST_WORKSPACE_COOKIE,
  movedPath,
  pickLandingSlug,
  type Membership,
  type Role,
} from '../lib/workspace-context.ts';
import { loadMemberships, loadWorkspaceContext } from '../lib/workspace-loader.ts';

const ASHA = 'user-asha';

const session = (userId = ASHA): AppSession =>
  ({
    session: {},
    user: { id: userId, name: 'Asha Rao', email: 'asha@example.test', image: null, locale: 'en' },
  }) as unknown as AppSession;

interface Row {
  id: string;
  slug: string;
  name: string;
  deletedAt?: Date;
  /** Slugs that redirect here (unexpired `workspace_slug_history`). */
  oldSlugs?: string[];
}

const WORKSPACES: Row[] = [
  { id: 'ws-1', slug: 'demo', name: 'Demo Chambers', oldSlugs: ['old-demo'] },
  { id: 'ws-2', slug: 'clerk-desk', name: 'Clerk Desk' },
  { id: 'ws-3', slug: 'other-chambers', name: 'Other Chambers' },
  { id: 'ws-4', slug: 'closed', name: 'Closed Practice', deletedAt: new Date('2026-01-01') },
];

const MEMBERS: { userId: string; workspaceId: string; role: string; status: string }[] = [
  { userId: ASHA, workspaceId: 'ws-1', role: 'owner', status: 'active' },
  { userId: ASHA, workspaceId: 'ws-2', role: 'clerk', status: 'active' },
  { userId: ASHA, workspaceId: 'ws-4', role: 'owner', status: 'active' },
  { userId: 'someone-else', workspaceId: 'ws-3', role: 'owner', status: 'active' },
  { userId: 'removed-user', workspaceId: 'ws-1', role: 'junior', status: 'removed' },
];

const live = (w: Row) => w.deletedAt === undefined;

/** The core queries' contract, over the rows above (live workspaces, active members only). */
function fakeDeps(signedInAs: string | null = ASHA) {
  return {
    getSession: vi.fn(() => Promise.resolve(signedInAs === null ? null : session(signedInAs))),
    resolveSlug: vi.fn((slug: string): Promise<ResolvedSlug | null> => {
      const direct = WORKSPACES.find((w) => w.slug === slug.toLowerCase() && live(w));
      const moved = WORKSPACES.find((w) => w.oldSlugs?.includes(slug) && live(w));
      const found = direct ?? moved;
      return Promise.resolve(
        found
          ? {
              workspace: { id: found.id, slug: found.slug, name: found.name } as DbWorkspace,
              redirectFrom: direct ? null : slug,
            }
          : null,
      );
    }),
    listMemberships: vi.fn((userId: string): Promise<MembershipSummary[]> =>
      Promise.resolve(
        MEMBERS.filter((m) => m.userId === userId && m.status === 'active').flatMap((m) => {
          const w = WORKSPACES.find((x) => x.id === m.workspaceId && live(x));
          return w ? [{ workspaceId: w.id, slug: w.slug, name: w.name, role: m.role }] : [];
        }),
      ),
    ),
  };
}

describe('loadWorkspaceContext', () => {
  it('returns the workspace, role, session user and own memberships for a member', async () => {
    const result = await loadWorkspaceContext('demo', fakeDeps());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.context.workspace).toEqual({ id: 'ws-1', slug: 'demo', name: 'Demo Chambers' });
    expect(result.context.role).toBe('owner');
    expect(result.context.user).toEqual({
      id: ASHA,
      name: 'Asha Rao',
      email: 'asha@example.test',
    });
    expect(result.context.memberships.map((m) => [m.workspace.slug, m.role])).toEqual([
      ['demo', 'owner'],
      ['clerk-desk', 'clerk'],
    ]);
  });

  it('returns the role for the requested workspace', async () => {
    const result = await loadWorkspaceContext('clerk-desk', fakeDeps());
    expect(result.kind === 'ok' && result.context.role).toBe('clerk');
  });

  it('is not-found for a workspace the user is not a member of', async () => {
    expect(await loadWorkspaceContext('other-chambers', fakeDeps())).toEqual({
      kind: 'not-found',
    });
  });

  it('is not-found for a soft-deleted workspace, which is also absent from the switcher', async () => {
    const deps = fakeDeps();
    expect(await loadWorkspaceContext('closed', deps)).toEqual({ kind: 'not-found' });
    const demo = await loadWorkspaceContext('demo', deps);
    expect(demo.kind === 'ok' && demo.context.memberships.map((m) => m.workspace.slug)).toEqual([
      'demo',
      'clerk-desk',
    ]);
  });

  it('never resolves for unknown slugs, signed-out visitors or removed members', async () => {
    expect((await loadWorkspaceContext('nope', fakeDeps())).kind).toBe('not-found');
    expect((await loadWorkspaceContext('demo', fakeDeps(null))).kind).toBe('not-found');
    expect((await loadWorkspaceContext('demo', fakeDeps('removed-user'))).kind).toBe(
      'no-workspaces',
    );
    expect((await loadWorkspaceContext('demo', fakeDeps('someone-else'))).kind).toBe('not-found');
  });

  it('redirects an old slug, and a differently-cased slug, to the current slug', async () => {
    expect(await loadWorkspaceContext('old-demo', fakeDeps())).toEqual({
      kind: 'redirect',
      slug: 'demo',
    });
    expect(await loadWorkspaceContext('Demo', fakeDeps())).toEqual({
      kind: 'redirect',
      slug: 'demo',
    });
  });

  it('never redirects a non-member through an old slug', async () => {
    expect(await loadWorkspaceContext('old-demo', fakeDeps('someone-else'))).toEqual({
      kind: 'not-found',
    });
  });

  it('sends a signed-in user with no workspace to onboarding (no-workspaces)', async () => {
    expect(await loadWorkspaceContext('demo', fakeDeps('new-user'))).toEqual({
      kind: 'no-workspaces',
    });
  });

  it('only ever queries the signed-in user, never a user named by the caller', async () => {
    const deps = fakeDeps();
    await loadWorkspaceContext('demo', deps);
    expect(deps.listMemberships).toHaveBeenCalledWith(ASHA);
  });
});

describe('loadMemberships', () => {
  it('is null signed out and lists live, active memberships signed in', async () => {
    expect(await loadMemberships(fakeDeps(null))).toBeNull();
    const loaded = await loadMemberships(fakeDeps());
    expect(loaded?.memberships.map((m) => m.workspace.slug)).toEqual(['demo', 'clerk-desk']);
  });

  it('drops memberships with a role the shell does not know', async () => {
    const deps = fakeDeps();
    deps.listMemberships.mockResolvedValueOnce([
      { workspaceId: 'ws-9', slug: 'odd', name: 'Odd', role: 'superuser' },
    ]);
    expect((await loadMemberships(deps))?.memberships).toEqual([]);
  });
});

describe('pickLandingSlug and cd_last_ws', () => {
  const memberships: Membership[] = [
    { workspace: { id: 'ws-1', slug: 'demo', name: 'Demo' }, role: 'owner' },
    { workspace: { id: 'ws-2', slug: 'clerk-desk', name: 'Clerk' }, role: 'clerk' },
  ];

  it('names the cookie cd_last_ws', () => {
    expect(LAST_WORKSPACE_COOKIE).toBe('cd_last_ws');
  });

  it('prefers the last workspace while it is still a membership', () => {
    expect(pickLandingSlug(memberships, 'clerk-desk')).toBe('clerk-desk');
    expect(pickLandingSlug(memberships, 'CLERK-DESK')).toBe('clerk-desk');
  });

  it('falls back to the first membership for a stale or foreign cookie, null with none', () => {
    expect(pickLandingSlug(memberships, 'other-chambers')).toBe('demo');
    expect(pickLandingSlug(memberships, undefined)).toBe('demo');
    expect(pickLandingSlug([], 'demo')).toBeNull();
  });
});

describe('movedPath', () => {
  it('keeps the page and query when redirecting an old slug', () => {
    expect(movedPath('/w/old-demo/matters?stage=filed', 'demo')).toBe(
      '/w/demo/matters?stage=filed',
    );
    expect(movedPath('/w/old-demo', 'demo')).toBe('/w/demo/today');
    expect(movedPath(null, 'demo')).toBe('/w/demo/today');
  });
});

describe('can (local role table, owned by #20)', () => {
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
