import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { getWorkspaceContext } from '../../../../lib/workspace-context.ts';

interface WorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

/**
 * Workspace-scoped routes. Non-members (and unknown slugs) get `notFound()` before anything
 * renders, so the shell never shows data for a workspace the user does not belong to.
 * The sidebar, topbar and switcher chrome arrive in #155.
 */
export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  return (
    <main
      id="main"
      tabIndex={-1}
      data-workspace-slug={context.workspace.slug}
      className="mx-auto w-full max-w-[1200px] px-4 py-6 outline-none md:px-6 md:py-8"
    >
      {children}
    </main>
  );
}
