import { buttonVariants } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = { title: 'Account' };

/** Account placeholder (passkeys, 2FA, sessions, connected accounts). Not workspace-scoped. */
export default async function AccountPage() {
  const t = await getTranslations('shell.account');
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 outline-none md:px-6 md:py-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <EmptyState
        data-pattern-state="empty"
        icon={<UserRound />}
        title={t('empty')}
        description={t('hint')}
        action={
          // `/` sends a signed-in user to their last workspace.
          <Link
            href="/"
            data-empty-action="home"
            className={buttonVariants({ variant: 'primary' })}
          >
            {t('action')}
          </Link>
        }
      />
    </main>
  );
}
