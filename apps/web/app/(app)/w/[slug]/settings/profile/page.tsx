// `/w/[slug]/settings/profile` (#284): the workspace profile (name, kind, time zone, default locale,
// practice city and the slug) inside the settings shell. Read on the workspace-scoped transaction
// (`withWorkspace`); saved through `updateWorkspaceProfileAction`. Clerks and up (`settings.read`)
// can open it; advocates and owners (`workspace.manage`) can edit it; only owners
// (`workspace.rename`) can rename the slug. Viewers get the permission-denied page.
//
// States: loading (skeleton rows while the profile streams in), error (`Could not load the workspace
// profile.` with `Try again`), offline (the settings banner; the form turns read-only) and
// permission-denied. `?__state=loading|error` previews the first two in development.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../../lib/env.ts';
import { can, type WorkspaceContext } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { logger } from '../../../../../../src/health.ts';

import { updateWorkspaceProfileAction, type ProfileView } from './actions.ts';
import { ProfileError } from './error.tsx';
import { ProfileForm, ProfileSkeleton } from './profile-form.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface ProfilePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

/** `?__state=loading|error` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.profile');
  return { title: t('metaTitle') };
}

async function loadProfile(context: WorkspaceContext): Promise<ProfileView | null> {
  const [{ db, withWorkspace }, { getWorkspaceProfile, toProfileView }] = await Promise.all([
    import('@causedeck/db'),
    import('@causedeck/core/workspaces'),
  ]);
  const workspaceId = context.workspace.id;
  const profile = await withWorkspace(db, { workspaceId, userId: context.user.id }, (tx) =>
    getWorkspaceProfile(tx, workspaceId),
  );
  return profile === null ? null : toProfileView(profile);
}

async function ProfileSection({
  context,
  state,
}: {
  context: WorkspaceContext;
  state: string | undefined;
}) {
  let profile: ProfileView | null;
  try {
    if (state === 'error') throw new Error('Profile error state (dev toggle)');
    profile = await loadProfile(context);
  } catch (error) {
    if (state !== 'error') logger.error({ err: error }, 'profile page: could not load profile');
    return <ProfileError />;
  }
  if (!profile) notFound();
  return (
    <ProfileForm
      workspaceId={context.workspace.id}
      profile={profile}
      canEdit={can(context.role, 'workspace.manage')}
      canRename={can(context.role, 'workspace.rename')}
      save={updateWorkspaceProfileAction}
    />
  );
}

export default async function ProfilePage({ params, searchParams }: ProfilePageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!can(context.role, 'settings.read')) return <PermissionDeniedPage />;
  const t = await getTranslations('settings.profile');
  const state = devState(query);

  return (
    <div data-route="settings-profile" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      {state === 'loading' ? (
        <ProfileSkeleton />
      ) : (
        <Suspense fallback={<ProfileSkeleton />}>
          <ProfileSection context={context} state={state} />
        </Suspense>
      )}
    </div>
  );
}
