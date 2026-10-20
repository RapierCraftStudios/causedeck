// Account two-factor section (#289): the status from the session's user (`twoFactorEnabled`) and
// `Set up`, which opens the 3-step setup dialog.
import { getTranslations } from 'next-intl/server';

import { SettingRow } from '../../../../components/settings/setting-row.tsx';
import { SettingSection } from '../../../../components/settings/setting-section.tsx';
import { TwoFactorSetup } from '../../../../components/settings/two-factor-setup-dialog.tsx';
import { enableTwoFactorAction, verifyTwoFactorAction } from '../actions.ts';

export async function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const t = await getTranslations('settings.account.twoFactor');
  return (
    <SettingSection id="two-factor" title={t('title')} description={t('description')}>
      <SettingRow
        id="two-factor-status"
        label={t('status')}
        description={enabled ? t('onHint') : t('offHint')}
      >
        <TwoFactorSetup
          enabled={enabled}
          enableTwoFactor={enableTwoFactorAction}
          verifyTwoFactor={verifyTwoFactorAction}
        />
      </SettingRow>
    </SettingSection>
  );
}
