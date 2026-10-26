// The `e2e` seed profile (#16): two fictional workspaces, one user per role in each, with fixed
// ids and timestamps so two seeds produce byte-identical rows. The Playwright fixtures import these
// constants to sign in as a role (`asUser`). Every name is invented; emails use the reserved
// `.test` TLD, so nothing here can reach a real person.
import { createHash } from 'node:crypto';

import { withWorkspace } from '../rls.ts';
import { invitation, member, organization, user, WORKSPACE_ROLES } from '../schema/auth.ts';
import { subscription } from '../schema/billing.ts';
import { briefShare } from '../schema/share.ts';

import { registerSeed, type SeedDb } from './index.ts';
// The e2e subscriptions reference catalogue rows: register the `plans` seeder (order 0) too.
import './plans.ts';

export type E2eRole = (typeof WORKSPACE_ROLES)[number];

/** Every row is stamped with this instant (no `now()` defaults). */
export const E2E_SEED_TIME = new Date('2026-03-01T00:00:00+05:30');

export const E2E_WORKSPACE_SLUGS = ['chennai-solo', 'bengaluru-chamber'] as const;
export type E2eWorkspaceSlug = (typeof E2E_WORKSPACE_SLUGS)[number];

export interface E2eWorkspace {
  id: string;
  slug: E2eWorkspaceSlug;
  name: string;
}

export interface E2eUser {
  id: string;
  name: string;
  email: string;
  role: E2eRole;
  workspace: E2eWorkspaceSlug;
}

export const E2E_WORKSPACES: Record<E2eWorkspaceSlug, E2eWorkspace> = {
  'chennai-solo': {
    id: '00000000-0000-4000-8000-00000000a001',
    slug: 'chennai-solo',
    name: 'Meenakshi Iyer Law Practice',
  },
  'bengaluru-chamber': {
    id: '00000000-0000-4000-8000-00000000a002',
    slug: 'bengaluru-chamber',
    name: 'Hebbal Chambers',
  },
};

const NAMES: Record<E2eWorkspaceSlug, Record<E2eRole, string>> = {
  'chennai-solo': {
    owner: 'Meenakshi Iyer',
    advocate: 'Karthik Raman',
    junior: 'Divya Sundaram',
    clerk: 'Murugan Pillai',
    viewer: 'Lakshmi Venkat',
  },
  'bengaluru-chamber': {
    owner: 'Ananya Hegde',
    advocate: 'Rohan Shetty',
    junior: 'Priya Gowda',
    clerk: 'Suresh Naik',
    viewer: 'Kavya Rao',
  },
};

/** `00000000-0000-4000-8000-0000000b0<ws><role>`: stable, readable in a SQL dump. */
function userId(workspaceIndex: number, roleIndex: number): string {
  return `00000000-0000-4000-8000-0000000b0${String(workspaceIndex + 1)}${String(roleIndex + 1).padStart(2, '0')}`;
}

function memberId(workspaceIndex: number, roleIndex: number): string {
  return `00000000-0000-4000-8000-0000000c0${String(workspaceIndex + 1)}${String(roleIndex + 1).padStart(2, '0')}`;
}

/**
 * Memberships beyond one-user-per-role (#179): the `chennai-solo` owner is also a `clerk` of
 * `bengaluru-chamber`, so the switcher and the workspace switch run against two real memberships.
 * `E2E_USERS` is unchanged (global-setup mints one session per entry).
 */
export interface E2eExtraMembership {
  id: string;
  user: { role: E2eRole; workspace: E2eWorkspaceSlug };
  workspace: E2eWorkspaceSlug;
  role: E2eRole;
}

export const E2E_EXTRA_MEMBERSHIPS: readonly E2eExtraMembership[] = [
  {
    id: '00000000-0000-4000-8000-0000000c0901',
    user: { role: 'owner', workspace: 'chennai-solo' },
    workspace: 'bengaluru-chamber',
    role: 'clerk',
  },
];

/**
 * A soft-deleted workspace (`deleted_at` set) the `chennai-solo` owner still owns: it must never
 * appear in the switcher, and `/w/mysuru-archived/...` must 404 (hard deletion is #31).
 */
export const E2E_DELETED_WORKSPACE = {
  id: '00000000-0000-4000-8000-00000000a009',
  slug: 'mysuru-archived',
  name: 'Mysuru Archived Practice',
  memberId: '00000000-0000-4000-8000-0000000c0902',
  owner: { role: 'owner', workspace: 'chennai-solo' },
} as const satisfies {
  id: string;
  slug: string;
  name: string;
  memberId: string;
  owner: { role: E2eRole; workspace: E2eWorkspaceSlug };
};

/** `<role>@<workspace>.e2e.test`. */
export function e2eEmail(workspace: E2eWorkspaceSlug, role: E2eRole): string {
  return `${role}@${workspace}.e2e.test`;
}

export const E2E_USERS: readonly E2eUser[] = E2E_WORKSPACE_SLUGS.flatMap((slug, w) =>
  WORKSPACE_ROLES.map((role, r) => ({
    id: userId(w, r),
    name: NAMES[slug][role],
    email: e2eEmail(slug, role),
    role,
    workspace: slug,
  })),
);

/** The seeded user holding `role` in `workspace`. */
export function e2eUser(role: E2eRole, workspace: E2eWorkspaceSlug = 'chennai-solo'): E2eUser {
  const found = E2E_USERS.find((u) => u.role === role && u.workspace === workspace);
  if (!found) throw new Error(`no e2e user for ${role} in ${workspace}`);
  return found;
}

export type E2eInvitationState = 'valid' | 'expired' | 'revoked' | 'used';

export interface E2eInvitation {
  id: string;
  /** Plaintext token for `/invite/<token>`; only its SHA-256 is seeded, as in production. */
  token: string;
  state: E2eInvitationState;
  workspace: E2eWorkspaceSlug;
  email: string;
  role: E2eRole;
}

/** Far enough ahead that a `valid` invitation never expires during a run. */
const E2E_INVITE_FAR_FUTURE = new Date('2099-01-01T00:00:00+05:30');
/**
 * Every seeded role is "granted" far in the future: a fixed, byte-stable value (not `now()`), and the
 * owner 2FA grace (#290, 7 days from the grant) never runs out for seeded owners. E2E specs that need
 * the grace over back-date `member.role_granted_at` themselves.
 */
const E2E_ROLE_GRANTED_AT = new Date('2099-01-01T00:00:00+05:30');

/**
 * Invitations to `chennai-solo` (#180) for the `bengaluru-chamber` viewer, who is not a member
 * there, one per state the `/invite/<token>` page shows. The tokens are fixed, test-only strings.
 */
export const E2E_INVITATIONS: Record<E2eInvitationState, E2eInvitation> = {
  valid: {
    id: '00000000-0000-4000-8000-0000000d0001',
    token: 'e2e-invite-valid-0000000000000000000000000',
    state: 'valid',
    workspace: 'chennai-solo',
    email: e2eEmail('bengaluru-chamber', 'viewer'),
    role: 'junior',
  },
  expired: {
    id: '00000000-0000-4000-8000-0000000d0002',
    token: 'e2e-invite-expired-00000000000000000000000',
    state: 'expired',
    workspace: 'chennai-solo',
    email: e2eEmail('bengaluru-chamber', 'viewer'),
    role: 'junior',
  },
  revoked: {
    id: '00000000-0000-4000-8000-0000000d0003',
    token: 'e2e-invite-revoked-00000000000000000000000',
    state: 'revoked',
    workspace: 'chennai-solo',
    email: e2eEmail('bengaluru-chamber', 'viewer'),
    role: 'junior',
  },
  used: {
    id: '00000000-0000-4000-8000-0000000d0004',
    token: 'e2e-invite-used-000000000000000000000000000',
    state: 'used',
    workspace: 'chennai-solo',
    email: e2eEmail('bengaluru-chamber', 'viewer'),
    role: 'junior',
  },
};

/**
 * A paid chamber subscription per e2e workspace (#203): the billing seat gate allows a free Junior
 * workspace one seat, and every e2e workspace already has more members, so each gets spare seats
 * for the invite and accept flows. Tests that need a full workspace lower `seats` themselves.
 */
export interface E2eSubscription {
  id: string;
  workspace: E2eWorkspaceSlug;
  planId: string;
  seats: number;
  clerkSeats: number;
}

export const E2E_SUBSCRIPTIONS: Record<E2eWorkspaceSlug, E2eSubscription> = {
  'chennai-solo': {
    id: '00000000-0000-4000-8000-0000000e0001',
    workspace: 'chennai-solo',
    planId: 'chamber-seat-1',
    seats: 10,
    clerkSeats: 4,
  },
  'bengaluru-chamber': {
    id: '00000000-0000-4000-8000-0000000e0002',
    workspace: 'bengaluru-chamber',
    planId: 'chamber-seat-1',
    seats: 10,
    clerkSeats: 4,
  },
};

function subscriptionRow(seeded: E2eSubscription, at: Date) {
  return {
    id: seeded.id,
    workspaceId: E2E_WORKSPACES[seeded.workspace].id,
    planId: seeded.planId,
    status: 'active',
    seats: seeded.seats,
    clerkSeats: seeded.clerkSeats,
    provider: 'mock',
    providerSubscriptionId: `sub_e2e_${seeded.workspace}`,
    providerCustomerId: `cust_e2e_${seeded.workspace}`,
    createdAt: at,
    updatedAt: at,
  };
}

/** SHA-256 hex, identical to `hashInvitationToken` in `@causedeck/core/workspaces`. */
export function e2eInvitationTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Seeded brief shares of chennai-solo (#507), one per state `/share/<token>` shows. */
export const E2E_SHARES = {
  valid: {
    id: '00000000-0000-4000-8000-0000000e0001',
    token: 'e2e-share-valid-00000000000000000000000000',
  },
  expired: {
    id: '00000000-0000-4000-8000-0000000e0002',
    token: 'e2e-share-expired-000000000000000000000000',
  },
  revoked: {
    id: '00000000-0000-4000-8000-0000000e0003',
    token: 'e2e-share-revoked-000000000000000000000000',
  },
} as const;
export const E2E_SHARE_TITLE = 'Iyer v. State of Tamil Nadu';

function shareRow(state: keyof typeof E2E_SHARES, at: Date) {
  const seeded = E2E_SHARES[state];
  return {
    id: seeded.id,
    workspaceId: E2E_WORKSPACES['chennai-solo'].id,
    tokenHash: createHash('sha256').update(seeded.token).digest('hex'),
    snapshot: {
      matterTitle: E2E_SHARE_TITLE,
      synopsis: 'A bail matter listed for arguments.',
      stage: 'Arguments',
      lastOrder: ['Notice issued to the State.'],
      lastHearing: null,
      openObligations: [],
      assembledAt: at.toISOString(),
    },
    createdBy: e2eUser('owner', 'chennai-solo').id,
    expiresAt: state === 'expired' ? at : E2E_INVITE_FAR_FUTURE,
    revokedAt: state === 'revoked' ? at : null,
    createdAt: at,
  };
}

function invitationRow(seeded: E2eInvitation, at: Date) {
  const base = {
    id: seeded.id,
    organizationId: E2E_WORKSPACES[seeded.workspace].id,
    email: seeded.email,
    role: seeded.role,
    inviterId: e2eUser('owner', seeded.workspace).id,
    tokenHash: e2eInvitationTokenHash(seeded.token),
    status: 'pending',
    expiresAt: E2E_INVITE_FAR_FUTURE,
    createdAt: at,
  };
  switch (seeded.state) {
    case 'valid':
      return base;
    case 'expired':
      return { ...base, expiresAt: at };
    case 'revoked':
      return { ...base, status: 'canceled', revokedAt: at };
    case 'used':
      return { ...base, status: 'accepted', acceptedAt: at };
  }
}

/**
 * Users are global; each workspace's organization, memberships and invitations are written inside
 * that workspace's scope (`withWorkspace`), because FORCE row-level security (#19) rejects tenant
 * rows written with no workspace pinned, as the app role and the owner alike.
 */
export async function seedE2e(db: SeedDb): Promise<void> {
  const at = E2E_SEED_TIME;
  await db
    .insert(user)
    .values(
      E2E_USERS.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: true,
        locale: 'en',
        createdAt: at,
        updatedAt: at,
      })),
    )
    .onConflictDoNothing();

  const owner = E2E_DELETED_WORKSPACE.owner;
  const workspaces: (typeof organization.$inferInsert)[] = [
    ...Object.values(E2E_WORKSPACES).map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      createdAt: at,
    })),
    {
      id: E2E_DELETED_WORKSPACE.id,
      name: E2E_DELETED_WORKSPACE.name,
      slug: E2E_DELETED_WORKSPACE.slug,
      createdAt: at,
      deletedAt: at,
    },
  ];
  const members: (typeof member.$inferInsert)[] = [
    ...E2E_WORKSPACE_SLUGS.flatMap((slug, w) =>
      WORKSPACE_ROLES.map((role, r) => ({
        id: memberId(w, r),
        organizationId: E2E_WORKSPACES[slug].id,
        userId: userId(w, r),
        role,
        joinedAt: at,
        roleGrantedAt: E2E_ROLE_GRANTED_AT,
        createdAt: at,
      })),
    ),
    ...E2E_EXTRA_MEMBERSHIPS.map((m) => ({
      id: m.id,
      organizationId: E2E_WORKSPACES[m.workspace].id,
      userId: e2eUser(m.user.role, m.user.workspace).id,
      role: m.role,
      joinedAt: at,
      roleGrantedAt: E2E_ROLE_GRANTED_AT,
      createdAt: at,
    })),
    {
      id: E2E_DELETED_WORKSPACE.memberId,
      organizationId: E2E_DELETED_WORKSPACE.id,
      userId: e2eUser(owner.role, owner.workspace).id,
      role: owner.role,
      joinedAt: at,
      roleGrantedAt: E2E_ROLE_GRANTED_AT,
      createdAt: at,
    },
  ];
  const invitations = Object.values(E2E_INVITATIONS).map((seeded) => invitationRow(seeded, at));
  const subscriptions = Object.values(E2E_SUBSCRIPTIONS).map((seeded) =>
    subscriptionRow(seeded, at),
  );

  for (const workspace of workspaces) {
    const workspaceId = workspace.id ?? '';
    await withWorkspace(db, { workspaceId }, async (tx) => {
      await tx.insert(organization).values(workspace).onConflictDoNothing();
      const own = members.filter((m) => m.organizationId === workspaceId);
      if (own.length > 0) await tx.insert(member).values(own).onConflictDoNothing();
      const invited = invitations.filter((i) => i.organizationId === workspaceId);
      if (invited.length > 0) await tx.insert(invitation).values(invited).onConflictDoNothing();
      if (workspace.slug === 'chennai-solo') {
        const shares = (Object.keys(E2E_SHARES) as (keyof typeof E2E_SHARES)[]).map((k) =>
          shareRow(k, at),
        );
        await tx.insert(briefShare).values(shares).onConflictDoNothing();
      }
      const paid = subscriptions.filter((s) => s.workspaceId === workspaceId);
      if (paid.length > 0) await tx.insert(subscription).values(paid).onConflictDoNothing();
    });
  }
}

registerSeed({ name: 'e2e-workspaces', profiles: ['e2e'], order: 10, run: seedE2e });
