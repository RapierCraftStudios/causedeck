'use client';

// Payment method (#256): the UPI Autopay mandate state (`active`, `pending` or `failed`) and the
// billing banners: a failed payment (danger-soft, with the grace countdown) or a plan that cancels
// at period end. `Update payment method` arrives with the billing actions (#257).
import { Alert, AlertDescription, AlertTitle } from '@causedeck/ui/alert';
import { Badge, type BadgeTone } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@causedeck/ui/card';
import { CircleAlert, CircleCheck, Clock, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { BillingBanner as Banner, PaymentMethodState } from './billing-view.ts';

const STATE_STYLE: Record<PaymentMethodState, { tone: BadgeTone; icon: LucideIcon }> = {
  active: { tone: 'success', icon: CircleCheck },
  pending: { tone: 'info', icon: Clock },
  failed: { tone: 'danger', icon: CircleAlert },
};

function UpdatePaymentMethod() {
  const t = useTranslations('billing');
  return (
    <Button variant="secondary" size="sm" disabled title={t('comingSoon')}>
      {t('paymentMethod.update')}
    </Button>
  );
}

export function PaymentMethodCard({
  state,
  className,
}: {
  state: PaymentMethodState;
  className?: string;
}) {
  const t = useTranslations('billing.paymentMethod');
  const { tone, icon: Icon } = STATE_STYLE[state];
  return (
    <Card data-slot="billing-payment-method" data-state={state} className={className}>
      <CardHeader>
        <CardTitle asChild>
          <h2>{t('title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-2">
        <Badge tone={tone} data-status={state}>
          <Icon aria-hidden="true" />
          {t(state)}
        </Badge>
        <p className="text-ink-muted text-sm">{t(`${state}Hint`)}</p>
        {state === 'failed' ? <UpdatePaymentMethod /> : null}
      </CardContent>
    </Card>
  );
}

export function BillingBanner({ banner }: { banner: Banner }) {
  const t = useTranslations('billing.banner');
  if (banner.key === 'cancels') {
    return (
      <Alert tone="warning" data-slot="billing-banner" data-banner={banner.key}>
        {t('cancels', { date: banner.date })}
      </Alert>
    );
  }
  return (
    <Alert
      tone="danger"
      data-slot="billing-banner"
      data-banner={banner.key}
      action={<UpdatePaymentMethod />}
    >
      <AlertTitle>{t('graceTitle')}</AlertTitle>
      <AlertDescription>
        {banner.key === 'grace'
          ? t('grace', { date: banner.date, days: banner.days })
          : t('paymentFailed')}
      </AlertDescription>
    </Alert>
  );
}
