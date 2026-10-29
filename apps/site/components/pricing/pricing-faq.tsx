/** Questions as native disclosure elements: keyboard accessible and no client JavaScript. */
export function PricingFaq({
  heading,
  items,
}: {
  heading: string;
  items: { q: string; a: string }[];
}) {
  return (
    <section aria-labelledby="pricing-faq" className="border-line mt-16 border-t pt-10">
      <h2 id="pricing-faq" className="text-ink font-serif text-3xl font-semibold">
        {heading}
      </h2>
      <div className="mt-6 max-w-[68ch] divide-y divide-[var(--line)]">
        {items.map((item) => (
          <details key={item.q} className="group py-4">
            <summary className="text-ink marker:text-ink-muted cursor-pointer font-medium">
              {item.q}
            </summary>
            <p className="text-ink-muted mt-2">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
