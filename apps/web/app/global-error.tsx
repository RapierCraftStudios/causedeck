'use client';

import { ErrorState } from '@causedeck/ui/patterns';
import { useEffect, useRef } from 'react';

import { reportError } from '../lib/report-error.ts';

import './globals.css';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Last-resort boundary: replaces the root layout, so there is no intl provider and the copy is
 * English. Shows only the digest, never the message or stack.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    reportError(error, { boundary: 'global', digest: error.digest });
  }, [error]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <html lang="en">
      <body className="bg-surface text-ink min-h-dvh font-sans antialiased">
        <main
          id="main"
          className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col items-center justify-center gap-4 px-4 md:px-6 xl:px-8"
        >
          <h1 ref={heading} tabIndex={-1} className="font-serif text-2xl font-medium outline-none">
            Something went wrong.
          </h1>
          <ErrorState
            className="w-full max-w-md"
            title="Your saved work is safe. Try again, or go back to Today."
            description={error.digest ? `Reference: ${error.digest}` : undefined}
            onRetry={reset}
          />
          {/* A full page load: the client router may be what broke. */}
          <a
            href="/"
            className="text-ink focus-visible:outline-ring rounded-sm text-sm font-medium underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
          >
            Go to Today
          </a>
        </main>
      </body>
    </html>
  );
}
