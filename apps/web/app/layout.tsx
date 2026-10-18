import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

import { LazyToaster } from '../components/lazy-toaster.tsx';
import { defaultLocale, isLocale } from '../i18n/routing.ts';

import { fontClassNames } from './fonts.ts';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'CauseDeck', template: '%s · CauseDeck' },
  description: 'Your court day, prepared.',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  // Lets `env(safe-area-inset-*)` resolve, so the phone bottom bar clears the home indicator.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const requested = await getLocale();
  const locale = isLocale(requested) ? requested : defaultLocale;
  const [messages, t, nonce] = await Promise.all([
    getMessages(),
    getTranslations('common'),
    headers().then((h) => h.get('x-nonce') ?? undefined),
  ]);

  return (
    <html lang={locale} className={fontClassNames(locale)} suppressHydrationWarning>
      <body className="bg-surface text-ink min-h-dvh font-sans antialiased">
        <a
          href="#main"
          className="bg-surface-raised text-ink focus-visible:outline-ring sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus-visible:outline-2"
        >
          {t('skipToContent')}
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          {...(nonce === undefined ? {} : { nonce })}
        >
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
            <LazyToaster />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
