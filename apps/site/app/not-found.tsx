import { Button } from '@causedeck/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';

import { siteEnv } from '../lib/env.ts';

export const metadata: Metadata = {
  title: 'Page not found | CauseDeck',
  description: 'This page does not exist. Go back to the CauseDeck home page.',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <section aria-labelledby="nf-title" className="py-12">
      <h1 id="nf-title" className="font-serif text-ink text-3xl font-semibold">
        We could not find that page
      </h1>
      <p className="text-ink-muted mt-4 max-w-[60ch]">
        The address may have changed or never existed. Start from the home page, or sign in to the
        app.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link href="/">Go to home</Link>
        </Button>
        <Button asChild variant="secondary">
          <a href={`${siteEnv.appUrl}/sign-in`}>Sign in</a>
        </Button>
      </div>
    </section>
  );
}
