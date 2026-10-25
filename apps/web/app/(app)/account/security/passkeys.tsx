// Account passkeys section (#289): the caller's passkeys from Better Auth (`listPasskeys`, scoped to
// the session's user), listed by `PasskeyList`.
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { PasskeyList, type PasskeyView } from '../../../../components/settings/passkey-list.tsx';
import { SettingSection } from '../../../../components/settings/setting-section.tsx';
import { getAuth } from '../../../../lib/auth.ts';
import { deletePasskeyAction } from '../actions.ts';

export async function loadPasskeys(): Promise<PasskeyView[]> {
  const passkeys = await getAuth().api.listPasskeys({ headers: await headers() });
  return passkeys
    .map((passkey) => ({
      id: passkey.id,
      name: passkey.name ?? null,
      createdAt: new Date(passkey.createdAt).toISOString(),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function PasskeysSection({ passkeys }: { passkeys: PasskeyView[] }) {
  const t = await getTranslations('settings.account.passkeys');
  return (
    <SettingSection id="passkeys" title={t('title')} description={t('description')}>
      <PasskeyList passkeys={passkeys} deletePasskey={deletePasskeyAction} />
    </SettingSection>
  );
}
