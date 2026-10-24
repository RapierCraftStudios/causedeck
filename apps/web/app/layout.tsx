import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { getLocale, getMessages, getTimeZone, getTranslations } from 'next-intl/server';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

import { IntlProvider } from '../components/intl-provider.tsx';
import { LazyToaster } from '../components/lazy-toaster.tsx';
import { defaultLocale, isLocale } from '../i18n/routing.ts';
import { isProd } from '../lib/env.ts';

import { fontClassNames } from './fonts.ts';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'CauseDeck', template: '%s · CauseDeck' },
  description: 'Your court day, prepared.',
  icons: { apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'CauseDeck', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  // Browser chrome colour of the installed app, per theme (the manifest holds the light one).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBFAF6' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1116' },
  ],
  // Lets `env(safe-area-inset-*)` resolve, so the phone bottom bar clears the home indicator.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const requested = await getLocale();
  const locale = isLocale(requested) ? requested : defaultLocale;
  const [messages, timeZone, t, nonce] = await Promise.all([
    getMessages(),
    getTimeZone(),
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
          <IntlProvider
            locale={locale}
            messages={messages}
            timeZone={timeZone}
            mode={isProd() ? 'production' : 'development'}
          >
            {children}
            <LazyToaster />
          </IntlProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
