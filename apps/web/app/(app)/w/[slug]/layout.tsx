import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell } from '../../../../components/shell/app-shell.tsx';
import { SIDEBAR_COOKIE, parseSidebarCookie } from '../../../../lib/sidebar-state.ts';
import { movedPath } from '../../../../lib/workspace-context.ts';
import { getWorkspaceResult } from '../../../../lib/workspace-loader.ts';

interface WorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

/**
 * Workspace-scoped routes. Non-members, unknown and soft-deleted workspaces get `notFound()` before
 * anything renders, so the shell never shows data for a workspace the user does not belong to. An
 * old slug (renamed within 90 days) redirects to the same page on the current slug, and a user with
 * no workspace at all goes to `/onboarding`. The last-workspace cookie (`cd_last_ws`) is set by
 * `proxy.ts`, since layouts cannot set cookies.
 */
export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { slug } = await params;
  const result = await getWorkspaceResult(slug);
  if (result.kind === 'redirect') {
    redirect(movedPath((await headers()).get('x-pathname'), result.slug));
  }
  if (result.kind === 'no-workspaces') redirect('/onboarding');
  if (result.kind === 'not-found') notFound();

  const sidebarState = parseSidebarCookie((await cookies()).get(SIDEBAR_COOKIE)?.value);
  return (
    <AppShell context={result.context} sidebarState={sidebarState}>
      {children}
    </AppShell>
  );
}
