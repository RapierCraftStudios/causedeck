'use client';

// The plan card (#256), the hero of the billing page: plan name in serif xl, the price of one charge
// in serif 3xl with `/ month` muted, a calm status badge, the renewal date and the GST note. The
// Junior variant offers the Advocate and Chamber plans instead. With `billing.manage` (`manage`)
// the card hosts `Change plan` and `Cancel plan` / `Resume plan` (#257); without it the card is
// read-only. The Junior upgrade buttons stay disabled: Junior has no subscription to change, and
// starting one needs the UPI Autopay mandate flow.
import { Badge, type BadgeTone } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@causedeck/ui/card';
import {
  Ban,
  CalendarX,
  CircleCheck,
  Clock,
  Pause,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type {
  ManageView,
  PaidPlanView,
  PlanStatus,
  Renewal,
  UpgradeOption,
} from './billing-view.ts';
import { CancelDialog } from './cancel-dialog.tsx';
import { ChangePlanDialog } from './change-plan-dialog.tsx';

const STATUS_STYLE: Record<PlanStatus['key'], { tone: BadgeTone; icon: LucideIcon }> = {
  active: { tone: 'success', icon: CircleCheck },
  pending: { tone: 'info', icon: Clock },
  pastDue: { tone: 'danger', icon: TriangleAlert },
  grace: { tone: 'danger', icon: TriangleAlert },
  paused: { tone: 'warning', icon: Pause },
  cancelsOn: { tone: 'warning', icon: CalendarX },
  cancelled: { tone: 'neutral', icon: Ban },
};

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const t = useTranslations('billing.status');
  const { tone, icon: Icon } = STATUS_STYLE[status.key];
  return (
    <Badge tone={tone} data-status={status.key}>
      <Icon aria-hidden="true" />
      {'date' in status ? t(status.key, { date: status.date }) : t(status.key)}
    </Badge>
  );
}

export interface PlanCardProps {
  plan: PaidPlanView;
  status: PlanStatus;
  renewal: Renewal;
  /** Present only with `billing.manage`: the owner's change and cancel controls. */
  manage?: { workspaceId: string; slug: string; view: ManageView } | undefined;
  className?: string;
}

export function PlanCard({ plan, status, renewal, manage, className }: PlanCardProps) {
  const t = useTranslations('billing');
  return (
    <Card data-slot="billing-plan" className={className}>
      <CardHeader>
        <p className="text-ink-muted text-xs font-medium tracking-wide uppercase">
          {t('plan.title')}
        </p>
        <CardTitle asChild>
          <h2 className="text-xl">{plan.name}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <PlanStatusBadge status={status} />
        </div>
        {plan.price === null ? null : (
          <p className="flex items-baseline gap-1">
            <span data-slot="billing-price" className="font-serif text-3xl tabular-nums">
              {plan.price}
            </span>
            <span className="text-ink-muted text-sm">
              {plan.interval === 'year' ? t('plan.perYear') : t('plan.perMonth')}
            </span>
          </p>
        )}
        {plan.breakdown === null ? null : (
          <p className="text-ink-muted text-sm tabular-nums">
            {t('plan.seatBreakdown', plan.breakdown)}
          </p>
        )}
        <p data-slot="billing-renewal" className="text-sm">
          {renewal.key === 'noRenewal'
            ? t('plan.noRenewal')
            : t(`plan.${renewal.key}`, { date: renewal.date })}
        </p>
        <p className="text-ink-muted text-sm">{t('plan.gstNote')}</p>
      </CardContent>
      {manage ? (
        <CardFooter className="flex flex-wrap items-start gap-2">
          <ChangePlanDialog
            workspaceId={manage.workspaceId}
            slug={manage.slug}
            manage={manage.view}
          />
          <CancelDialog workspaceId={manage.workspaceId} slug={manage.slug} manage={manage.view} />
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function JuniorPlanCard({ upgrades }: { upgrades: readonly UpgradeOption[] }) {
  const t = useTranslations('billing');
  return (
    <section data-slot="billing-junior" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <p className="text-ink-muted text-xs font-medium tracking-wide uppercase">
            {t('plan.title')}
          </p>
          <CardTitle asChild>
            <h2 className="text-xl">{t('junior.title')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-ink-muted text-sm">{t('junior.body')}</p>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {upgrades.map((upgrade) => {
          const name = t(`junior.${upgrade.kind}`);
          return (
            <Card key={upgrade.kind} data-slot="billing-upgrade" data-plan-kind={upgrade.kind}>
              <CardHeader>
                <CardTitle asChild>
                  <h3 className="text-xl">{name}</h3>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="flex items-baseline gap-1">
                  <span className="font-serif text-3xl tabular-nums">
                    {t('junior.from', { price: upgrade.fromPrice })}
                  </span>
                  <span className="text-ink-muted text-sm">{t('plan.perMonth')}</span>
                </p>
                <p className="text-ink-muted text-sm">
                  {upgrade.kind === 'chamber'
                    ? t('junior.chamberBody', { minSeats: upgrade.minSeats })
                    : t('junior.advocateBody')}
                </p>
                <p className="text-ink-muted text-sm">{t('plan.gstNote')}</p>
              </CardContent>
              <CardFooter>
                <Button variant="primary" disabled title={t('comingSoon')}>
                  {t('junior.upgrade', { plan: name })}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
