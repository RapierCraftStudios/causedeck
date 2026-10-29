import { Button } from '@causedeck/ui/button';

import { annualSavingPaise, chamberExamplePaise, planSignInHref } from '../../lib/pricing.ts';
import { formatInr } from '../../lib/inr.ts';
import { fill, planPrice, type PlanId, type PricingCopy } from '../../content/pricing.ts';

const ORDER_CLASS: Record<PlanId, string> = {
  advocate: 'order-first md:order-none',
  junior: '',
  chamber: '',
};

/** Price figure in large tabular numerals. */
function Amount({ children }: { children: string }) {
  return (
    <span className="text-ink font-serif text-5xl font-semibold tabular-nums">{children}</span>
  );
}

export function PlanCard({
  id,
  copy,
  recommended = false,
}: {
  id: PlanId;
  copy: PricingCopy;
  recommended?: boolean;
}) {
  const price = planPrice(id);
  const plan = copy.plans[id];
  const headingId = `plan-${id}`;
  return (
    <li
      className={`border-line bg-surface-raised flex flex-col rounded-2xl border p-6 ${ORDER_CLASS[id]} ${recommended ? 'border-accent ring-accent ring-1' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-ink font-serif text-2xl font-semibold">
          {plan.name}
        </h3>
        {recommended ? (
          <span className="bg-accent-soft text-ink rounded-full px-2.5 py-0.5 text-xs font-medium">
            {copy.recommended}
          </span>
        ) : null}
      </div>
      <p className="text-ink-muted mt-1 text-sm">{plan.tagline}</p>

      <div className="mt-6 min-h-24">
        {price.monthlyPaise === 0 ? (
          <p>
            <Amount>{copy.free}</Amount>
          </p>
        ) : (
          <>
            <p
              className={
                price.annualPaise === null ? '' : 'group-has-[#bill-year:checked]/bill:hidden'
              }
            >
              <Amount>{formatInr(price.monthlyPaise)}</Amount>{' '}
              <span className="text-ink-muted text-sm">
                {id === 'chamber' ? copy.perSeatMonth : copy.perMonth}, {copy.gstSuffix}
              </span>
            </p>
            {price.annualPaise === null ? (
              <p className="text-ink-muted mt-1 text-sm">{copy.billedMonthlyOnly}</p>
            ) : (
              <p className="hidden group-has-[#bill-year:checked]/bill:block">
                <Amount>{formatInr(price.annualPaise)}</Amount>{' '}
                <span className="text-ink-muted text-sm">
                  {copy.perYear}, {copy.gstSuffix}
                </span>
                <span className="text-ink-muted mt-1 block text-sm">
                  {fill(copy.annualSaving, { amount: formatInr(annualSavingPaise(id)) })}
                </span>
              </p>
            )}
          </>
        )}
      </div>

      <ul className="text-ink mt-4 space-y-2 text-sm">
        {plan.features.map((feature) => (
          <li key={feature} className="border-line border-t pt-2">
            {feature}
          </li>
        ))}
      </ul>

      {id === 'chamber' ? (
        <div className="text-ink-muted mt-4 space-y-2 text-sm">
          <p>{fill(copy.chamberSeats, { count: String(price.minSeats) })}</p>
          <p>{fill(copy.clerkSeat, { amount: formatInr(price.clerkSeatPaise ?? 0) })}</p>
          <p className="tabular-nums">
            {fill(copy.chamberExample, {
              seats: String(price.minSeats),
              amount: formatInr(chamberExamplePaise(price.minSeats)),
            })}
          </p>
        </div>
      ) : null}

      <div className="mt-auto pt-6">
        <Button
          asChild
          variant={recommended ? 'primary' : 'secondary'}
          size="lg"
          className="w-full"
        >
          <a href={planSignInHref(id)} aria-describedby={headingId}>
            {plan.cta}
          </a>
        </Button>
      </div>
    </li>
  );
}
