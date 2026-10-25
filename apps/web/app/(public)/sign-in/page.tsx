import { MAGIC_LINK_EXPIRES_IN_SECONDS } from '@causedeck/auth/server';
import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from '../../../components/locale-switcher.tsx';
import { getSession } from '../../../lib/auth.ts';
import { serverEnv } from '../../../lib/env.ts';
import { safeNextPath } from '../../../lib/safe-next.ts';

import { SignInForm, type SignInError } from './sign-in-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signIn');
  return { title: t('metaTitle') };
}

/** Better Auth's magic-link failures that mean "ask for a new link". */
const EXPIRED_CODES = new Set(['EXPIRED_TOKEN', 'INVALID_TOKEN', 'ATTEMPTS_EXCEEDED']);

function toSignInError(raw: string | string[] | undefined): SignInError | null {
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (!code) return null;
  if (code === 'access_denied') return 'access_denied';
  if (EXPIRED_CODES.has(code.toUpperCase())) return 'expired';
  return 'generic';
}

/** Placeholder targets until the Launch milestone legal pages exist. */
const TERMS_HREF = '/terms';
const PRIVACY_HREF = '/privacy';

const footerLink = (href: string) => (chunks: ReactNode) => (
  <Link
    href={href}
    className="text-ink focus-visible:outline-ring rounded-sm underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
  >
    {chunks}
  </Link>
);

/** Court-list-like hairline rows of Newsreader numerals: quiet texture, no imagery. */
function EditorialPane({ wordmark, pullLine }: { wordmark: string; pullLine: string }) {
  const rows = [3, 7, 12, 14, 18, 21, 26, 31];
  return (
    <aside className="bg-surface-sunken relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
      <span>
        <img
          src="/brand/causedeck-logo.svg"
          alt={wordmark}
          width={160}
          height={105}
          className="h-auto w-40 dark:hidden"
        />
        <img
          src="/brand/causedeck-logo-dark.svg"
          alt={wordmark}
          width={160}
          height={105}
          className="hidden h-auto w-40 dark:block"
        />
      </span>
      <ol aria-hidden="true" className="text-ink-subtle flex flex-col font-serif select-none">
        {rows.map((n) => (
          <li key={n} className="border-line flex items-baseline gap-6 border-b py-3">
            <span className="w-16 text-4xl tabular-nums opacity-40">{n}</span>
            <span className="bg-line h-px flex-1" />
          </li>
        ))}
      </ol>
      <p className="max-w-md font-serif text-2xl leading-snug">{pullLine}</p>
    </aside>
  );
}

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const next = safeNextPath(Array.isArray(params.next) ? params.next[0] : params.next, '/');
  if (await getSession()) redirect(next);

  const t = await getTranslations('auth.signIn');
  const googleEnabled = serverEnv().AUTH_GOOGLE_ENABLED;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      <EditorialPane wordmark={t('wordmark')} pullLine={t('pullLine')} />
      <div className="flex min-h-dvh flex-col p-6 md:items-center">
        <header className="w-full lg:hidden">
          <span className="flex items-center gap-2">
            <img
              src="/brand/causedeck-mark.svg"
              alt=""
              width={24}
              height={24}
              className="size-6 dark:hidden"
            />
            <img
              src="/brand/causedeck-mark-dark.svg"
              alt=""
              width={24}
              height={24}
              className="hidden size-6 dark:block"
            />
            <span className="font-serif text-lg font-medium">{t('wordmark')}</span>
          </span>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="motion-safe:animate-rise flex w-full flex-1 flex-col justify-center gap-8 py-10 outline-none motion-safe:[--motion-transform:translateY(8px)] md:max-w-[420px]"
        >
          <div className="flex flex-col gap-2">
            <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
            <p className="text-ink-muted text-base">{t('tagline')}</p>
          </div>
          <SignInForm
            googleEnabled={googleEnabled}
            next={next}
            initialError={toSignInError(params.error)}
            expiresInMinutes={MAGIC_LINK_EXPIRES_IN_SECONDS / 60}
          />
        </main>
        <footer className="text-ink-muted flex w-full flex-col gap-2 text-xs md:max-w-[420px]">
          <p>
            {t.rich('terms', { terms: footerLink(TERMS_HREF), privacy: footerLink(PRIVACY_HREF) })}
          </p>
          <p className="flex items-center gap-1.5">
            <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
            {t('hosted')}
          </p>
          <LocaleSwitcher variant="compact" />
        </footer>
      </div>
    </div>
  );
}
