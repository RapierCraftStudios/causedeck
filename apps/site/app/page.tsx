import { Button } from '@causedeck/ui/button';

import { siteEnv } from '../lib/env.ts';
import { pageMetadata, softwareApplicationJsonLd } from '../lib/seo.ts';

export const metadata = pageMetadata({
  title: 'Software for advocates',
  description:
    'CauseDeck keeps your cases, cause lists and court-day preparation in one place. Software for advocates.',
  path: '',
});

// Placeholder hero; the landing page (#90) replaces it.
export default function HomePage() {
  return (
    <>
      <section aria-labelledby="hero-title" className="py-12">
        <h1 id="hero-title" className="font-serif text-ink text-4xl font-semibold md:text-5xl">
          Practice software for advocates
        </h1>
        <p className="text-ink-muted mt-4 max-w-[60ch] text-lg">
          Cases, cause lists and court-day preparation, in one quiet workspace.
        </p>
        <div className="mt-8">
          <Button asChild>
            <a href={`${siteEnv.appUrl}/sign-in`}>Sign in</a>
          </Button>
        </div>
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd()) }}
      />
    </>
  );
}
