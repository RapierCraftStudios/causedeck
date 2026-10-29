import { Alert } from '@causedeck/ui/alert';
import { getTranslations } from 'next-intl/server';

/** The standing notice on the enquiry log: records only, nothing is sent to the enquirer. */
export async function GatedNotice() {
  const t = await getTranslations('enquiry');
  return (
    <Alert tone="info" role="note" data-slot="enquiry-gated-notice">
      {t('gatedNotice')}
    </Alert>
  );
}
