'use client';

// The two owner buttons that go through the payment provider's UPI Autopay mandate (#1072):
// `Upgrade to <plan>` on the Junior card (checkout) and `Update payment method`. Each calls a
// billing action; the mock provider completes the mandate at once (the page refreshes on the new
// state), while a real provider hands back a hosted link that the owner follows. Failures come
// back as `billing.errors.*` keys. Disabled offline, and without `billing.manage` (`manage` unset).
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { startCheckout, updatePaymentMethod, type MandateOutcome } from './actions.ts';
import { billingErrorKey, useOnline, type BillingErrorKey } from './seat-manager.tsx';
import type { Result } from '../../../../../lib/safe-action.ts';

export interface MandateScope {
  workspaceId: string;
  slug: string;
}

function MandateButton({
  run,
  manage,
  variant,
  size,
  children,
  slot,
}: {
  run: (scope: MandateScope) => Promise<Result<MandateOutcome>>;
  manage: MandateScope | undefined;
  variant: 'primary' | 'secondary';
  size?: 'sm';
  children: ReactNode;
  slot: string;
}) {
  const t = useTranslations('billing');
  const router = useRouter();
  const online = useOnline();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillingErrorKey | null>(null);

  async function click() {
    if (!manage) return;
    setError(null);
    setPending(true);
    try {
      const result = await run({ workspaceId: manage.workspaceId, slug: manage.slug });
      const key = billingErrorKey(result);
      if (key !== null) {
        setError(key);
      } else if (result.ok && result.data.error === undefined && result.data.mandateUrl) {
        window.location.assign(result.data.mandateUrl);
        return;
      } else {
        router.refresh();
      }
    } catch {
      setError('generic');
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant={variant}
        {...(size ? { size } : {})}
        data-slot={slot}
        disabled={!manage || !online || pending}
        aria-busy={pending || undefined}
        title={manage ? undefined : t('errors.forbidden')}
        onClick={() => void click()}
      >
        {children}
      </Button>
      {error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null}
    </div>
  );
}

export function UpgradeButton({
  planId,
  seats,
  manage,
  children,
}: {
  planId: string;
  seats: number;
  manage: MandateScope | undefined;
  children: ReactNode;
}) {
  return (
    <MandateButton
      slot="billing-upgrade-button"
      variant="primary"
      manage={manage}
      run={(scope) => startCheckout({ ...scope, planId, seats })}
    >
      {children}
    </MandateButton>
  );
}

export function UpdatePaymentMethodButton({ manage }: { manage: MandateScope | undefined }) {
  const t = useTranslations('billing');
  return (
    <MandateButton
      slot="billing-update-payment-method"
      variant="secondary"
      size="sm"
      manage={manage}
      run={(scope) => updatePaymentMethod(scope)}
    >
      {t('paymentMethod.update')}
    </MandateButton>
  );
}
