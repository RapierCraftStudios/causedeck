// The data-residency statement of step 1 (#92): shown before anything is entered, and linked to the
// security page.
import { Alert } from '@causedeck/ui/alert';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function IndiaNote() {
  const t = useTranslations('onboarding.india');
  return (
    <Alert tone="info" icon={<ShieldCheck />} data-slot="india-note">
      <p>
        {t('body')}{' '}
        <a href="/security" className="underline underline-offset-4">
          {t('link')}
        </a>
      </p>
    </Alert>
  );
}
