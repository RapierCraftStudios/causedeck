import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Staff console', template: '%s · CauseDeck staff' },
  // Never indexed; the X-Robots-Tag header says the same for non-HTML responses.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { colorScheme: 'light dark' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-surface text-ink min-h-dvh font-sans antialiased">
        <a
          href="#main"
          className="bg-surface-raised text-ink focus-visible:outline-ring sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus-visible:outline-2"
        >
          Skip to content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          {...(nonce === undefined ? {} : { nonce })}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
