import { Alert } from '@causedeck/ui/alert';
import { getTranslations } from 'next-intl/server';

/** The standing notice: a computed date is a proposal until the advocate confirms it. */
export async function LimitationGatedNotice() {
  const t = await getTranslations('limitation');
  return (
    <Alert tone="info" role="note" data-slot="limitation-gated-notice">
      {t('gatedNotice')}
    </Alert>
  );
}
