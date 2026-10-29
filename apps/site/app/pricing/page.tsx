import { PlanCard } from '../../components/pricing/plan-card.tsx';
import { CompareTable } from '../../components/pricing/compare-table.tsx';
import { PlanToggle } from '../../components/pricing/plan-toggle.tsx';
import { PricingFaq } from '../../components/pricing/pricing-faq.tsx';
import {
  fill,
  PRICES_CONFIRMED,
  pricingCopy,
  UPI_AUTOPAY_CAP_PAISE,
} from '../../content/pricing.ts';
import { formatInr } from '../../lib/inr.ts';
import { pricingJsonLd } from '../../lib/pricing.ts';
import { pageMetadata } from '../../lib/seo.ts';

const copy = pricingCopy();

export const metadata = pageMetadata({
  title: copy.metaTitle,
  description: copy.metaDescription,
  path: 'pricing',
});

export default function PricingPage() {
  return (
    <div className="group/bill">
      <header className="max-w-[68ch]">
        <h1 className="text-ink font-serif text-4xl font-semibold text-balance md:text-5xl">
          {copy.title}
        </h1>
        <p className="text-ink-muted mt-4 text-lg">{copy.intro}</p>
      </header>

      {PRICES_CONFIRMED ? null : (
        <p
          role="note"
          className="bg-warning-soft text-ink mt-6 max-w-[68ch] rounded-lg px-4 py-3 text-sm"
        >
          {copy.placeholderNote}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <PlanToggle legend={copy.billingLegend} monthly={copy.monthly} annual={copy.annual} />
        <a
          href="#compare"
          className="cd-link text-accent text-sm underline underline-offset-2 md:hidden"
        >
          {copy.compareLink}
        </a>
      </div>

      <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PlanCard id="advocate" copy={copy} recommended />
        <PlanCard id="junior" copy={copy} />
        <PlanCard id="chamber" copy={copy} />
      </ul>

      <div className="mt-10 grid max-w-[68ch] gap-6">
        <section aria-labelledby="gst">
          <h2 id="gst" className="text-ink font-serif text-2xl font-semibold">
            {copy.gstHeading}
          </h2>
          <p className="text-ink-muted mt-2">{copy.gstNote}</p>
        </section>
        <section aria-labelledby="autopay">
          <h2 id="autopay" className="text-ink font-serif text-2xl font-semibold">
            {copy.autopayHeading}
          </h2>
          <p className="text-ink-muted mt-2">
            {fill(copy.autopayNote, { cap: formatInr(UPI_AUTOPAY_CAP_PAISE) })}
          </p>
        </section>
      </div>

      <section id="compare" aria-labelledby="compare-title" className="mt-16 scroll-mt-20">
        <h2 id="compare-title" className="text-ink font-serif text-3xl font-semibold">
          {copy.compareHeading}
        </h2>
        <div className="mt-6">
          <CompareTable copy={copy} />
        </div>
      </section>

      <PricingFaq heading={copy.faqHeading} items={copy.faq} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd()) }}
      />
    </div>
  );
}
