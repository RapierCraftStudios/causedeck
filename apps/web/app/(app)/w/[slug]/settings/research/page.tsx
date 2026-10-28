// `/w/[slug]/settings/research` (#80): the research providers of the workspace. Lists the built-in
// public search pages and the workspace's own https templates (SCC Online, Manupatra), with a form
// to add or replace one. Needs `workspace.manage` (advocate and above); a direct URL without it
// shows the permission-denied page.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { canOpenSettings } from '../../../../../../lib/settings-nav.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';

import { removeProviderTemplateAction, saveProviderTemplateAction } from './actions.ts';
import { ProviderForm } from './provider-form.tsx';

interface ResearchSettingsPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('nav.research') };
}

export default async function ResearchSettingsPage({ params }: ResearchSettingsPageProps) {
  const { slug } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  if (!canOpenSettings(context.role, 'research')) return <PermissionDeniedPage />;
  const [{ inWorkspace }, { BUILT_IN_PROVIDERS, listProviderTemplates }, t] = await Promise.all([
    import('@causedeck/core/runtime'),
    import('@causedeck/core/research'),
    getTranslations('settingsResearch'),
  ]);
  const scope = { workspaceId: context.workspace.id, userId: context.user.id };
  const templates = await inWorkspace(scope, (tx) => listProviderTemplates(tx, scope));

  return (
    <div data-route="settings-research" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <SettingSection id="research-builtin" title={t('builtInHeading')}>
        <ul className="flex flex-col gap-1 py-2 text-sm">
          {BUILT_IN_PROVIDERS.map((provider) => (
            <li key={provider.key}>
              {provider.label} <span className="text-ink-muted">({provider.host})</span>
            </li>
          ))}
        </ul>
      </SettingSection>
      <SettingSection id="research-own" title={t('ownHeading')}>
        <ProviderForm
          workspaceId={context.workspace.id}
          providers={templates}
          save={saveProviderTemplateAction}
          remove={removeProviderTemplateAction}
        />
      </SettingSection>
    </div>
  );
}
