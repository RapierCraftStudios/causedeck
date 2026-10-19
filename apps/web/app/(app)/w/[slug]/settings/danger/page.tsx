// `/w/[slug]/settings/danger` (#284): owners only (`workspace.delete`). The danger zone lists the
// destructive entry points (transfer ownership, delete workspace), disabled with an explanation
// until their flows arrive in #288 and #31.
import { Button } from '@causedeck/ui/button';
import { getTranslations } from 'next-intl/server';

import { DangerZone } from '../../../../../../components/settings/danger-zone.tsx';
import { SettingRow } from '../../../../../../components/settings/setting-row.tsx';
import { settingsPlaceholderPage } from '../../../../../../components/settings/settings-placeholder-page.tsx';

async function DangerRows() {
  const t = await getTranslations('settings.danger');
  return (
    <DangerZone title={t('title')} description={t('description')}>
      {(['transfer', 'delete'] as const).map((row) => (
        <SettingRow
          key={row}
          id={`danger-${row}`}
          label={t(`${row}.label`)}
          description={t(`${row}.description`)}
          note={t('unavailable')}
        >
          <Button
            variant="destructive"
            disabled
            title={t('unavailable')}
            aria-describedby={`danger-${row}-description`}
          >
            {t(`${row}.action`)}
          </Button>
        </SettingRow>
      ))}
    </DangerZone>
  );
}

export default settingsPlaceholderPage('danger', DangerRows);
