import type { PricingCopy } from '../../content/pricing.ts';

/** Plan comparison with column and row headers; zebra rows use the surface roles. */
export function CompareTable({ copy }: { copy: PricingCopy }) {
  return (
    <div
      className="border-line overflow-x-auto rounded-2xl border"
      tabIndex={0}
      role="region"
      aria-label={copy.compareCaption}
    >
      <table className="w-full min-w-[34rem] border-collapse text-start text-sm">
        <caption className="sr-only">{copy.compareCaption}</caption>
        <thead>
          <tr className="bg-surface-sunken">
            <th scope="col" className="text-ink px-4 py-3 text-start font-semibold">
              {copy.compareFeature}
            </th>
            {(['junior', 'advocate', 'chamber'] as const).map((id) => (
              <th
                key={id}
                scope="col"
                className="text-ink px-4 py-3 text-start font-serif text-base font-semibold"
              >
                {copy.plans[id].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {copy.compareRows.map((row, index) => (
            <tr key={row.label} className={index % 2 === 0 ? 'bg-surface' : 'bg-surface-raised'}>
              <th scope="row" className="text-ink px-4 py-3 text-start font-medium">
                {row.label}
              </th>
              <td className="text-ink-muted px-4 py-3">{row.junior}</td>
              <td className="text-ink-muted px-4 py-3">{row.advocate}</td>
              <td className="text-ink-muted px-4 py-3">{row.chamber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
