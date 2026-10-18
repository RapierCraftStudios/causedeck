import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ThemeToggle } from '../components/theme-toggle.tsx';
import { getHomeSession, homeDestination } from '../lib/home-route.ts';

export default async function HomePage() {
  const destination = homeDestination(await getHomeSession());
  if (destination) redirect(destination);

  const t = await getTranslations('home');
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col px-4 md:px-6 xl:px-8">
      <header className="flex justify-end py-4">
        <ThemeToggle />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center"
      >
        <h1 className="font-serif text-3xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted font-sans text-base">{t('tagline')}</p>
        <Link
          href="/sign-in"
          className="text-ink focus-visible:outline-ring mt-4 rounded-sm text-sm font-medium underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
        >
          {t('signIn')}
        </Link>
      </main>
    </div>
  );
}
