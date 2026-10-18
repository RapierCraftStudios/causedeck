import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = { title: 'Sign in' };

/** Placeholder: Better Auth sign-in replaces this page in #12. */
export default async function SignInPage() {
  const t = await getTranslations('signIn');
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col items-center justify-center gap-2 px-4 text-center md:px-6 xl:px-8"
    >
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <p className="text-ink-muted text-base">{t('body')}</p>
    </main>
  );
}
