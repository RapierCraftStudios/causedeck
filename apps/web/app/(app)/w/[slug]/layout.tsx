import type * as RuntimeModule from '@causedeck/core/runtime';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell } from '../../../../components/shell/app-shell.tsx';
import type { ShellSupportSession } from '../../../../components/shell/support-banner.tsx';
import { getWorkspaceFlags } from '../../../../lib/flags.ts';
import { loadOwnerTwoFactorState } from '../../../../lib/require-2fa-for-owners.ts';
import { SIDEBAR_COOKIE, parseSidebarCookie } from '../../../../lib/sidebar-state.ts';
import { movedPath } from '../../../../lib/workspace-context.ts';
import type { WorkspaceContext } from '../../../../lib/workspace-context.ts';
import { getWorkspaceResult } from '../../../../lib/workspace-loader.ts';
import { logger } from '../../../../src/health.ts';

import type { ShellDeletion } from './settings/danger/cooloff-banner.tsx';

type Runtime = typeof RuntimeModule;

/**
 * The active support session the shell banner shows (#313): owners only, so no one else pays for
 * the query. A failed read logs and shows no banner rather than breaking the shell.
 */
async function loadSupportSession(
  runtime: Runtime,
  context: WorkspaceContext,
): Promise<ShellSupportSession | null> {
  if (context.role !== 'owner') return null;
  try {
    const { activeSupportSessionIn } = runtime;
    const session = await activeSupportSessionIn({
      workspaceId: context.workspace.id,
      userId: context.user.id,
    });
    return session?.expiresAt
      ? { id: session.id, expiresAt: session.expiresAt.toISOString() }
      : null;
  } catch (error) {
    logger.error({ err: error }, 'workspace layout: could not load the support session');
    return null;
  }
}

/**
 * The workspace deletion in its cool-off, for the shell banner every member sees (#305). A failed
 * read logs and shows no banner rather than breaking the shell.
 */
async function loadDeletion(
  runtime: Runtime,
  context: WorkspaceContext,
): Promise<ShellDeletion | null> {
  try {
    const { activeWorkspaceDeletionIn } = runtime;
    const deletion = await activeWorkspaceDeletionIn({
      workspaceId: context.workspace.id,
      userId: context.user.id,
    });
    return deletion?.cooloffUntil
      ? { jobId: deletion.id, cooloffUntil: deletion.cooloffUntil.toISOString() }
      : null;
  } catch (error) {
    logger.error({ err: error }, 'workspace layout: could not load the workspace deletion');
    return null;
  }
}

interface WorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

/**
 * Workspace-scoped routes. Non-members, unknown and soft-deleted workspaces get `notFound()` before
 * anything renders, so the shell never shows data for a workspace the user does not belong to. An
 * old slug (renamed within 90 days) redirects to the same page on the current slug, and a user with
 * no workspace at all goes to `/onboarding`. The last-workspace cookie (`cd_last_ws`) is set by
 * `proxy.ts`, since layouts cannot set cookies. Flags are evaluated here, server-side, and only
 * their boolean values reach the shell (#22). An owner past the 7-day 2FA grace gets the shell's
 * persistent banner (#290, lib/require-2fa-for-owners.ts), and gets the active support session, if
 * any, for the shell's support banner (#313). Every member sees the cool-off banner while a
 * workspace deletion waits (#305).
 */
export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { slug } = await params;
  const result = await getWorkspaceResult(slug);
  if (result.kind === 'redirect') {
    redirect(movedPath((await headers()).get('x-pathname'), result.slug));
  }
  if (result.kind === 'no-workspaces') redirect('/onboarding');
  if (result.kind === 'not-found') notFound();

  // Loaded once for both banners: concurrent dynamic imports of one module can race.
  const runtime = await import('@causedeck/core/runtime');
  const [cookieStore, flags, ownerTwoFactor, supportSession, deletion] = await Promise.all([
    cookies(),
    getWorkspaceFlags(result.context),
    loadOwnerTwoFactorState(result.context.workspace.id, result.context.role),
    loadSupportSession(runtime, result.context),
    loadDeletion(runtime, result.context),
  ]);
  const sidebarState = parseSidebarCookie(cookieStore.get(SIDEBAR_COOKIE)?.value);
  return (
    <AppShell
      context={result.context}
      sidebarState={sidebarState}
      flags={flags}
      ownerTwoFactor={ownerTwoFactor}
      supportSession={supportSession}
      deletion={deletion}
    >
      {children}
    </AppShell>
  );
}
