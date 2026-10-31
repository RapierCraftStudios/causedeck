import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

import { SiteFooter } from '../components/site-footer.tsx';
import { SiteHeader } from '../components/site-header.tsx';
import { siteEnv } from '../lib/env.ts';
import { SITE_NAME } from '../lib/seo.ts';

import { fontClassNames } from './fonts.ts';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteEnv.siteUrl),
  applicationName: SITE_NAME,
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111111' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontClassNames} suppressHydrationWarning>
      <body className="bg-surface text-ink flex min-h-dvh flex-col antialiased">
        <a href="#main" className="cd-skip-link">
          Skip to content
        </a>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SiteHeader appUrl={siteEnv.appUrl} />
          <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-10 md:px-6">
            {children}
          </main>
          <SiteFooter />
        </ThemeProvider>
        {siteEnv.analyticsSrc === undefined ? null : <script defer src={siteEnv.analyticsSrc} />}
      </body>
    </html>
  );
}
