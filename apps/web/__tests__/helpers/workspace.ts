// A shell `WorkspaceContext` fixture for unit tests (#179). The shell used to read an in-memory
// stub; it now loads memberships from the database (lib/workspace-loader.ts), so component tests
// build the same shape here: the user owns `demo` and is `clerk` of `clerk-desk`.
import type { Membership, Role, WorkspaceContext } from '../../lib/workspace-context.ts';

export const TEST_USER = { id: 'user-1', name: 'Asha Rao', email: 'asha@example.test' };

export const TEST_MEMBERSHIPS: readonly Membership[] = [
  { workspace: { id: 'ws-1', slug: 'demo', name: 'Demo Chambers' }, role: 'owner' },
  { workspace: { id: 'ws-2', slug: 'clerk-desk', name: 'Clerk Desk' }, role: 'clerk' },
];

/** The context for one of `TEST_MEMBERSHIPS` (default `demo`), optionally with another role. */
export function testWorkspaceContext(slug = 'demo', role?: Role): WorkspaceContext {
  const current = TEST_MEMBERSHIPS.find((m) => m.workspace.slug === slug);
  if (!current) throw new Error(`no test membership for ${slug}`);
  return {
    user: TEST_USER,
    workspace: current.workspace,
    role: role ?? current.role,
    memberships: [...TEST_MEMBERSHIPS],
  };
}
