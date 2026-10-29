import { Alert, AlertDescription, AlertTitle } from '@causedeck/ui/alert';
import { getTranslations } from 'next-intl/server';

/** Shown when no counsel-reviewed rule exists: nothing can be computed from a draft. */
export async function NoRulesNotice() {
  const t = await getTranslations('limitation');
  return (
    <Alert tone="warning" role="note" data-slot="limitation-no-rules">
      <AlertTitle>{t('noRules.title')}</AlertTitle>
      <AlertDescription>{t('noRules.body')}</AlertDescription>
    </Alert>
  );
}
