import { Alert } from '@causedeck/ui/alert';
import { useTranslations } from 'next-intl';

/** The standing notice: invoices are prepared for the lawyer and never sent by the system. */
export function FeesGatedNotice() {
  const t = useTranslations('fees');
  return (
    <Alert tone="info" role="note" data-slot="fees-gated-notice">
      {t('gatedNotice')}
    </Alert>
  );
}
