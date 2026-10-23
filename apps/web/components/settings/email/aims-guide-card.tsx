// The AIMS setup guide (#54): three steps to have the AIMS cause-list email reach the member's
// intake address. Static copy, so it renders on the server.
import { useTranslations } from 'next-intl';

import { SettingSection } from '../setting-section.tsx';

export function AimsGuideCard() {
  const t = useTranslations('emailIntake.aims');
  return (
    <SettingSection
      id="email-aims-section"
      data-slot="email-aims-guide"
      title={t('title')}
      description={t('description')}
    >
      <div className="flex flex-col gap-2 py-3">
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
        </ol>
        <p className="text-ink-muted text-sm">{t('note')}</p>
      </div>
    </SettingSection>
  );
}
