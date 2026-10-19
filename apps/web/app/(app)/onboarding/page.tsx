import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { createWorkspaceAction } from './actions.ts';
import { CreateWorkspaceForm } from './create-workspace-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspace.onboarding');
  return { title: t('metaTitle') };
}

/**
 * `/onboarding` (#179): create a workspace in a single centred card. Signed-in only (proxy and the
 * `(app)` layout); reached from `/` when the user has no workspace and from the switcher's
 * `Create workspace`. The full first-run wizard is the Launch milestone.
 */
export default async function OnboardingPage() {
  const t = await getTranslations('workspace.onboarding');
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-dvh items-center justify-center px-4 py-12 md:px-6"
    >
      <section
        aria-labelledby="onboarding-title"
        className="bg-surface border-line flex w-full max-w-md flex-col gap-6 rounded-lg border p-6 shadow-sm md:p-8"
      >
        <header className="flex flex-col gap-1.5">
          <h1 id="onboarding-title" className="font-serif text-2xl font-medium">
            {t('title')}
          </h1>
          <p className="text-ink-muted text-sm">{t('description')}</p>
        </header>
        <CreateWorkspaceForm action={createWorkspaceAction} />
      </section>
    </main>
  );
}
