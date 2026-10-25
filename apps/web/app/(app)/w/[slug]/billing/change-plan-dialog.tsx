'use client';

// `Change plan` (#257): a two-step dialog. Step one chooses a plan (the plans of the current
// billing interval); step two confirms the summary from `quoteChange`: the new charge per period,
// GST at 18%, the GST-inclusive total, the prorated amount due now and the effective date. A
// dearer plan applies now; a cheaper one at the end of the period. Disabled offline.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@causedeck/ui/dialog';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { changePlan, quoteChange, type QuoteView } from './actions.ts';
import type { ManageView, PlanOption } from './billing-view.ts';
import { billingErrorKey, QuoteSummary, useOnline, type BillingErrorKey } from './seat-manager.tsx';

export interface ChangePlanDialogProps {
  workspaceId: string;
  slug: string;
  manage: ManageView;
}

/** The seats to carry over to `plan`: at least its minimum; no clerk seats if it has none. */
function countsFor(plan: PlanOption, manage: ManageView) {
  return {
    seats: Math.max(manage.seats, plan.minSeats),
    clerkSeats: plan.clerkSeats ? manage.clerkSeats : 0,
  };
}

export function ChangePlanDialog({ workspaceId, slug, manage }: ChangePlanDialogProps) {
  const t = useTranslations('billing');
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PlanOption | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillingErrorKey | null>(null);

  function reset(next: boolean) {
    setOpen(next);
    setSelected(null);
    setQuote(null);
    setError(null);
  }

  async function choose(plan: PlanOption) {
    setSelected(plan);
    setError(null);
    setPending(true);
    try {
      const result = await quoteChange({
        workspaceId,
        planId: plan.id,
        ...countsFor(plan, manage),
      });
      const key = billingErrorKey(result);
      if (key === null && result.ok && !result.data.error) setQuote(result.data.quote);
      else setError(key ?? 'generic');
    } catch {
      setError('generic');
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (selected === null) return;
    setError(null);
    setPending(true);
    try {
      const key = billingErrorKey(
        await changePlan({
          workspaceId,
          slug,
          planId: selected.id,
          ...countsFor(selected, manage),
        }),
      );
      if (key === null) reset(false);
      else setError(key);
    } catch {
      setError('generic');
    } finally {
      setPending(false);
    }
  }

  const options = manage.planOptions.filter((plan) => plan.id !== manage.planId);

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="secondary" disabled={!online || options.length === 0}>
          {t('plan.change')}
        </Button>
      </DialogTrigger>
      <DialogContent data-dialog="change-plan">
        <DialogHeader>
          <DialogTitle>
            {quote && selected
              ? t('changePlan.confirmTitle', { plan: selected.name })
              : t('changePlan.title')}
          </DialogTitle>
          <DialogDescription>
            {quote ? t('changePlan.confirmBody') : t('changePlan.chooseBody')}
          </DialogDescription>
        </DialogHeader>
        {quote ? (
          <QuoteSummary quote={quote} />
        ) : (
          <ul className="flex flex-col gap-2" aria-busy={pending || undefined}>
            {options.map((plan) => (
              <li key={plan.id}>
                <Button
                  variant="secondary"
                  className="w-full justify-between"
                  data-plan-option={plan.id}
                  disabled={pending || !online}
                  onClick={() => void choose(plan)}
                >
                  <span>{plan.name}</span>
                  <span className="text-ink-muted tabular-nums">
                    {plan.perSeat
                      ? t('changePlan.perSeat', { price: plan.price })
                      : t('changePlan.flat', { price: plan.price })}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null}
        <DialogFooter>
          {quote ? (
            <>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setQuote(null);
                }}
              >
                {t('changePlan.back')}
              </Button>
              <Button
                variant="primary"
                disabled={pending || !online}
                aria-busy={pending || undefined}
                onClick={() => void confirm()}
              >
                {t('changePlan.confirm')}
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                reset(false);
              }}
            >
              {t('changePlan.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
