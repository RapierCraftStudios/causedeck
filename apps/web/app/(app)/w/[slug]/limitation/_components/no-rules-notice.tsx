// Sync, with the `useTranslations` hook: it renders on the server and in Storybook alike.
import { Alert, AlertDescription, AlertTitle } from '@causedeck/ui/alert';
import { useTranslations } from 'next-intl';

/** Shown when no counsel-reviewed rule exists: nothing can be computed from a draft. */
export function NoRulesNotice() {
  const t = useTranslations('limitation');
  return (
    <Alert tone="warning" role="note" data-slot="limitation-no-rules">
      <AlertTitle>{t('noRules.title')}</AlertTitle>
      <AlertDescription>{t('noRules.body')}</AlertDescription>
    </Alert>
  );
}
