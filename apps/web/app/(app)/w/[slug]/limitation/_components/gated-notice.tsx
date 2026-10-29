// Sync, with the `useTranslations` hook: it renders on the server and in Storybook alike.
import { Alert } from '@causedeck/ui/alert';
import { useTranslations } from 'next-intl';

/** The standing notice: a computed date is a proposal until the advocate confirms it. */
export function LimitationGatedNotice() {
  const t = useTranslations('limitation');
  return (
    <Alert tone="info" role="note" data-slot="limitation-gated-notice">
      {t('gatedNotice')}
    </Alert>
  );
}
