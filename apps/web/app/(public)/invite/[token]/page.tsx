import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = { title: 'Invitation' };

/** Placeholder. TODO(#18): look up the invitation token and accept it for the signed-in user. */
export default async function InvitePage() {
  const t = await getTranslations('auth.invite');
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col items-center justify-center gap-2 px-4 text-center outline-none md:px-6 xl:px-8"
    >
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <p className="text-ink-muted text-base">{t('body')}</p>
    </main>
  );
}
