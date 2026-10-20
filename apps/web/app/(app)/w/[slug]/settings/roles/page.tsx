// `/w/[slug]/settings/roles` (#285): what each role can see and do. The permission matrix is
// rendered from the policy in `@causedeck/auth` with the clerk limits stated; below it the two role
// settings (`advocatesCanInvite`, `ownersSeeRestrictedMatters`), which owners (`member.role`) change
// through `updateRoleSettingsAction` and everyone else sees read-only; then the restricted matters
// the viewer may read, with their allowed members. Clerks and up (`settings.read`) can open it;
// viewers get the permission-denied page. Read on the workspace-scoped transaction (`inWorkspace`).
//
// States: loading (skeleton cards while the settings stream in), error (`Could not load the role
// settings.` with `Try again`), empty (no restricted matters), offline (the settings banner; the
// switches turn read-only) and permission-denied. `?__state=loading|error|empty` previews the first
// three in development.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../../lib/env.ts';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import { can, type WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import { updateRoleSettingsAction, type RoleSettingsView } from './actions.ts';
import { RolesError } from './error.tsx';
import { MatterRestrictions, type MatterRestrictionView } from './matter-restrictions.tsx';
import { PermissionMatrix } from './permission-matrix.tsx';
import { RoleSettingsForm, RolesSkeleton } from './role-settings-form.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface RolesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

interface RolesData {
  settings: RoleSettingsView;
  restrictions: MatterRestrictionView[];
}

/** `?__state=loading|error|empty` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.roles');
  return { title: t('metaTitle') };
}

async function loadRoles(context: WorkspaceContext): Promise<RolesData> {
  const [{ inWorkspace }, { getRoleSettings }, { listMatterRestrictions }] = await Promise.all([
    import('@causedeck/core/runtime'),
    import('@causedeck/core/workspaces'),
    import('@causedeck/core/matters'),
  ]);
  const workspaceId = context.workspace.id;
  const userId = context.user.id;
  return inWorkspace({ workspaceId, userId }, async (tx) => {
    const settings = await getRoleSettings(tx, workspaceId);
    const restrictions = await listMatterRestrictions(tx, { workspaceId, userId });
    return {
      settings,
      restrictions: restrictions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  });
}

async function RolesSection({
  context,
  state,
}: {
  context: WorkspaceContext;
  state: string | undefined;
}) {
  let data: RolesData;
  try {
    if (state === 'error') throw new Error('Roles error state (dev toggle)');
    data = await loadRoles(context);
  } catch (error) {
    if (state !== 'error') logger.error({ err: error }, 'roles page: could not load role settings');
    return <RolesError />;
  }
  return (
    <>
      <RoleSettingsForm
        workspaceId={context.workspace.id}
        settings={data.settings}
        canEdit={can(context.role, 'member.role')}
        save={updateRoleSettingsAction}
      />
      <MatterRestrictions restrictions={state === 'empty' ? [] : data.restrictions} />
    </>
  );
}

export default async function RolesPage({ params, searchParams }: RolesPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'roles')) return <PermissionDeniedPage />;
  const t = await getTranslations('settings.roles');
  const state = devState(query);

  return (
    <div data-route="settings-roles" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <PermissionMatrix />
      {state === 'loading' ? (
        <RolesSkeleton />
      ) : (
        <Suspense fallback={<RolesSkeleton />}>
          <RolesSection context={context} state={state} />
        </Suspense>
      )}
    </div>
  );
}
