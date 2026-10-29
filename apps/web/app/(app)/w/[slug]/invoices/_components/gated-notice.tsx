import { Alert } from '@causedeck/ui/alert';
import { getTranslations } from 'next-intl/server';

/** The standing notice: invoices are prepared for the lawyer and never sent by the system. */
export async function FeesGatedNotice() {
  const t = await getTranslations('fees');
  return (
    <Alert tone="info" role="note" data-slot="fees-gated-notice">
      {t('gatedNotice')}
    </Alert>
  );
}
