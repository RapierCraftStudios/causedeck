import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell } from '../../../../components/shell/app-shell.tsx';
import { SIDEBAR_COOKIE, parseSidebarCookie } from '../../../../lib/sidebar-state.ts';
import { getWorkspaceContext } from '../../../../lib/workspace-context.ts';

interface WorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

/**
 * Workspace-scoped routes. Non-members (and unknown slugs) get `notFound()` before anything
 * renders, so the shell never shows data for a workspace the user does not belong to.
 */
export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const sidebarState = parseSidebarCookie((await cookies()).get(SIDEBAR_COOKIE)?.value);
  return (
    <AppShell context={context} sidebarState={sidebarState}>
      {children}
    </AppShell>
  );
}
