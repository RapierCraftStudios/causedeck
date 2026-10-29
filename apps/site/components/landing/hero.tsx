import { Button } from '@causedeck/ui/button';

import { landingCopy, type LandingLocale } from '../../content/landing.ts';

import { CourtDayPreview } from './court-day-preview.tsx';

export function Hero({
  signInHref,
  locale = 'en',
}: {
  signInHref: string;
  locale?: LandingLocale;
}) {
  const { hero } = landingCopy(locale);
  return (
    <section
      aria-labelledby="hero-title"
      lang={locale}
      className="grid items-center gap-10 py-6 lg:grid-cols-[2fr_3fr] lg:gap-12 lg:py-12"
    >
      <div>
        <h1
          id="hero-title"
          className="text-ink font-serif text-4xl leading-tight font-semibold text-balance md:text-5xl"
        >
          {hero.headline}
        </h1>
        <p className="text-ink-muted mt-4 max-w-[48ch] text-lg">{hero.subhead}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <a href={signInHref}>{hero.primaryCta}</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#court-day">{hero.secondaryCta}</a>
          </Button>
        </div>
      </div>
      <div>
        <CourtDayPreview locale={locale} />
        <p className="text-ink-muted mt-3 max-w-[60ch] text-sm">{hero.boardSummary}</p>
      </div>
    </section>
  );
}
