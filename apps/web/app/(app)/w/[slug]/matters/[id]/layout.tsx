// `/w/[slug]/matters/[id]` (#390, #40 part 3): the matter workspace shell. Every tab renders inside
// it: the offline banner, the sticky matter header (title, clients, status, owner, `Sensitive`, the
// matter menu) and the tab bar from the registry (lib/matters/tab-registry.ts; tabs register in
// lib/matters/tabs.ts), with the tab content as its `tabpanel`, all inside the polite live region
// that announces state changes. The matter comes from `getMatterOverview` in the member's
// workspace scope (shared with the page through React `cache`). A member of another workspace, a
// restricted matter or an unknown id renders only the page, whose `notFound()` shows this
// segment's not-found screen; a role without `matter.read` gets the permission-denied screen.
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { MatterAnnouncer } from '../../../../../../components/matters/matter-announcer.tsx';
import { MatterHeader } from '../../../../../../components/matters/matter-header.tsx';
import { MatterTabs } from '../../../../../../components/matters/matter-tab-bar.tsx';
import { MattersPermissionDenied } from '../../../../../../components/matters/matters-list.tsx';
import { MattersOfflineBanner } from '../../../../../../components/matters/matters-offline-banner.tsx';
import { mattersHref } from '../../../../../../lib/matters/list-params.ts';
import { matterTabHref, matterTabs } from '../../../../../../lib/matters/tab-registry.ts';
import { registerMatterTabs } from '../../../../../../lib/matters/tabs.ts';
import { loadMatterOverview } from '../../../../../../lib/matters/workspace.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import { setSensitiveAction } from './actions.ts';

interface MatterLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string; id: string }>;
}

export default async function MatterLayout({ children, params }: MatterLayoutProps) {
  const { slug, id } = await params;
  // The workspace layout already checks membership; checking again keeps the shell safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'matter.read')) return <MattersPermissionDenied />;

  const loaded = await loadMatterOverview(context, id);
  // The page calls `notFound()` (this segment's not-found screen) or renders its own state.
  if (loaded.kind !== 'overview') return <>{children}</>;

  registerMatterTabs();
  const t = await getTranslations('matters.workspace');
  const { header } = loaded.overview;
  const entries = matterTabs(context.role).map((tab) => ({
    id: tab.id,
    href: matterTabHref(slug, header.id, tab),
    label: t(`tabs.${tab.labelKey}` as 'tabs.overview'),
  }));

  return (
    <div data-route="matter" className="flex min-w-0 flex-col gap-2">
      <MattersOfflineBanner />
      <MatterAnnouncer>
        <MatterHeader
          matter={{
            id: header.id,
            title: header.title,
            status: header.status,
            sensitive: header.sensitive,
            owner: header.owner?.name ?? null,
            clients: header.clients.map((person) => ({ id: person.id, name: person.name })),
          }}
          workspaceId={context.workspace.id}
          listHref={mattersHref(slug)}
          canRestrict={can(context.role, 'matter.restrict')}
          setSensitiveAction={setSensitiveAction}
        />
        <MatterTabs entries={entries} label={t('tabListLabel')}>
          {children}
        </MatterTabs>
      </MatterAnnouncer>
    </div>
  );
}
