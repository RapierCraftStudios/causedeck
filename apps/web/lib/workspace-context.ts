// The workspace the shell is rendering, and who the user is in it. An in-memory dev stub until
// workspaces and membership land (#18); roles, permissions and flag keys are local unions until
// `@causedeck/auth` (#20) and `@causedeck/flags` (#22) export the real ones.

/** Workspace roles, least to most privileged. TODO(#20): re-export from `@causedeck/auth`. */
export type Role = 'viewer' | 'clerk' | 'junior' | 'advocate' | 'owner';

/** Permissions the shell gates on. TODO(#20): re-export from `@causedeck/auth`. */
export type Permission =
  'billing.read' | 'invoices.read' | 'limitation.read' | 'insights.read' | 'settings.read';

/** Feature flags the shell gates on. TODO(#22): re-export from `@causedeck/flags`. */
export type FlagKey = 'invoices.enabled' | 'limitation.enabled';

export interface Workspace {
  id: string;
  slug: string;
  name: string;
}

export interface Membership {
  workspace: Workspace;
  role: Role;
}

/** The signed-in user. TODO(#12): from the Better Auth session. */
export interface ShellUser {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceContext {
  user: ShellUser;
  workspace: Workspace;
  role: Role;
  /** Every workspace the user belongs to (for the switcher). Never other users' workspaces. */
  memberships: Membership[];
}

/** Role-to-permission table. TODO(#20): replace with the central `can()` policy. */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ['billing.read', 'invoices.read', 'limitation.read', 'insights.read', 'settings.read'],
  advocate: ['limitation.read', 'insights.read', 'settings.read'],
  junior: ['limitation.read', 'settings.read'],
  clerk: ['settings.read'],
  viewer: [],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Dev stub data. The dev user belongs to two workspaces; `other-chambers` is not theirs. */
export const DEV_USER_ID = 'dev-user';

const DEV_USERS: readonly ShellUser[] = [
  { id: DEV_USER_ID, name: 'Asha Rao', email: 'asha@example.test' },
  { id: 'someone-else', name: 'Someone Else', email: 'someone@example.test' },
];

export const DEV_WORKSPACES: readonly Workspace[] = [
  { id: 'ws-1', slug: 'demo', name: 'Demo Chambers' },
  { id: 'ws-2', slug: 'clerk-desk', name: 'Clerk Desk' },
  { id: 'ws-3', slug: 'other-chambers', name: 'Other Chambers' },
];

const DEV_MEMBERSHIPS: readonly { userId: string; workspaceId: string; role: Role }[] = [
  { userId: DEV_USER_ID, workspaceId: 'ws-1', role: 'owner' },
  { userId: DEV_USER_ID, workspaceId: 'ws-2', role: 'clerk' },
  { userId: 'someone-else', workspaceId: 'ws-3', role: 'owner' },
];

export interface WorkspaceContextOptions {
  /** TODO(#12/#18): comes from the session, never from the URL. */
  userId?: string | undefined;
}

/**
 * The context for `slug`, or `null` when the workspace does not exist or the user is not a member.
 * Callers render `notFound()` on `null` so nothing about the workspace leaks.
 * TODO(#18): replace with a membership-checked loader; authorisation comes from the session.
 */
export function getWorkspaceContext(
  slug: string,
  { userId = DEV_USER_ID }: WorkspaceContextOptions = {},
): Promise<WorkspaceContext | null> {
  const memberships = DEV_MEMBERSHIPS.filter((m) => m.userId === userId).flatMap((m) => {
    const workspace = DEV_WORKSPACES.find((w) => w.id === m.workspaceId);
    return workspace ? [{ workspace, role: m.role }] : [];
  });
  const current = memberships.find((m) => m.workspace.slug === slug);
  if (!current) return Promise.resolve(null);
  const user = DEV_USERS.find((u) => u.id === userId) ?? { id: userId, name: userId, email: '' };
  return Promise.resolve({
    user,
    workspace: current.workspace,
    role: current.role,
    memberships,
  });
}
