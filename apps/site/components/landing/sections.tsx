// The landing page sections below the hero (#90). Server components only: no client JS beyond the
// board preview, so the page stays inside the JS budget. Reveal motion is CSS (globals.css).
import { Button } from '@causedeck/ui/button';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { SAMPLE_LABEL, landingCopy, type LandingLocale } from '../../content/landing.ts';

interface Props {
  locale?: LandingLocale;
}

function Section({
  id,
  title,
  locale,
  children,
}: {
  id: string;
  title: string;
  locale: LandingLocale;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      lang={locale}
      className="cd-reveal border-line scroll-mt-20 border-t py-12 md:py-16"
    >
      <h2
        id={`${id}-title`}
        className="text-ink font-serif text-3xl font-semibold text-balance md:text-4xl"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ProblemStrip({ locale = 'en' }: Props) {
  const { problem } = landingCopy(locale);
  return (
    <section
      aria-label={problem.heading}
      lang={locale}
      className="border-line border-y py-6 md:py-8"
    >
      <ul className="text-ink grid gap-2 font-serif text-xl md:grid-cols-3 md:gap-6 md:text-2xl">
        {problem.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

export function LoopSection({ locale = 'en' }: Props) {
  const { loop } = landingCopy(locale);
  return (
    <Section id="court-day" title={loop.heading} locale={locale}>
      <p className="text-ink-muted mt-3 max-w-[60ch] text-lg">{loop.intro}</p>
      <ol className="mt-8 grid gap-4 md:grid-cols-2">
        {loop.beats.map((beat, index) => (
          <li key={beat.id} className="border-line bg-surface-raised rounded-2xl border p-5">
            <p className="text-ink-subtle text-sm tabular-nums">
              {String(index + 1).padStart(2, '0')}
            </p>
            <h3 className="text-ink mt-1 font-serif text-xl font-semibold">{beat.title}</h3>
            <p className="text-ink-muted mt-2">{beat.body}</p>
            <p className="bg-accent-soft text-ink mt-4 rounded-lg px-3 py-2 text-sm tabular-nums">
              {beat.sample}
              <span className="text-ink-muted block text-xs">{SAMPLE_LABEL}</span>
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function ProvenanceSection({ locale = 'en' }: Props) {
  const { provenance } = landingCopy(locale);
  return (
    <Section id="provenance" title={provenance.heading} locale={locale}>
      <div className="mt-6 grid items-start gap-8 md:grid-cols-2">
        <div>
          <p className="text-ink-muted max-w-[60ch] text-lg">{provenance.body}</p>
          <ul className="text-ink mt-6 space-y-2">
            {provenance.points.map((point) => (
              <li key={point} className="flex gap-2">
                <span aria-hidden="true" className="text-success">
                  ✓
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <figure className="border-line bg-surface-raised m-0 rounded-2xl border p-5">
          <blockquote className="text-ink m-0 font-serif text-lg">
            &ldquo;
            <mark className="bg-warning-soft text-ink rounded px-0.5">{provenance.quote}</mark>
            &rdquo;
          </blockquote>
          <figcaption className="text-ink-muted mt-3 text-sm tabular-nums">
            {provenance.source}
            <span className="block text-xs">{SAMPLE_LABEL}</span>
          </figcaption>
        </figure>
      </div>
    </Section>
  );
}

export function TrustSection({ locale = 'en' }: Props) {
  const { trust } = landingCopy(locale);
  return (
    <Section id="trust" title={trust.heading} locale={locale}>
      <p className="text-ink-muted mt-3 max-w-[60ch] text-lg">{trust.intro}</p>
      <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {trust.claims.map((claim) => (
          <li key={claim.id} className="border-line bg-surface-raised rounded-2xl border p-5">
            <h3 className="text-ink font-serif text-lg font-semibold">{claim.title}</h3>
            <p className="text-ink-muted mt-2">{claim.body}</p>
            <Link href={claim.href} className="cd-link text-accent mt-3 inline-block underline">
              How this works
              <span className="sr-only">: {claim.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      <h3 className="text-ink mt-10 font-serif text-xl font-semibold">{trust.levels.heading}</h3>
      <dl className="mt-4 grid gap-3 md:grid-cols-2">
        {trust.levels.items.map((item) => (
          <div key={item.level} className="flex gap-3">
            <dt className="text-ink font-medium tabular-nums">{item.level}</dt>
            <dd className="text-ink-muted m-0">{item.body}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink mt-6 font-medium">{trust.undo}</p>
    </Section>
  );
}

export function CourtsSection({ locale = 'en' }: Props) {
  const { courts } = landingCopy(locale);
  return (
    <Section id="courts" title={courts.heading} locale={locale}>
      <p className="text-ink-muted mt-3 max-w-[60ch] text-lg">{courts.body}</p>
      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {courts.courts.map((court) => (
          <li key={court.name} className="border-line bg-surface-raised rounded-2xl border p-5">
            <h3 className="text-ink font-serif text-lg font-semibold">{court.name}</h3>
            <p className="text-ink-muted mt-1">{court.note}</p>
          </li>
        ))}
      </ul>
      <p className="text-ink-muted mt-6">{courts.other}</p>
    </Section>
  );
}

export function Faq({ locale = 'en' }: Props) {
  const { faq } = landingCopy(locale);
  return (
    <Section id="faq" title={faq.heading} locale={locale}>
      <div className="mt-6 max-w-[68ch] divide-y divide-[var(--line)]">
        {faq.items.map((item) => (
          <details key={item.id} className="group py-4">
            <summary className="text-ink cursor-pointer font-medium">{item.q}</summary>
            <p className="text-ink-muted mt-2">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

export function CtaBand({ signInHref, locale = 'en' }: Props & { signInHref: string }) {
  const { cta } = landingCopy(locale);
  return (
    <section
      aria-labelledby="cta-title"
      lang={locale}
      className="bg-accent-soft my-12 rounded-3xl px-6 py-10 md:px-12"
    >
      <h2 id="cta-title" className="text-ink font-serif text-3xl font-semibold">
        {cta.heading}
      </h2>
      <p className="text-ink mt-2 max-w-[50ch] text-lg">{cta.body}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <a href={signInHref}>{cta.primary}</a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/contact/">{cta.secondary}</Link>
        </Button>
      </div>
    </section>
  );
}
