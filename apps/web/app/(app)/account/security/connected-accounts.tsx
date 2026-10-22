// Account connected accounts section (#289): the caller's linked sign-in providers
// (`listUserAccounts`), read-only. Magic links and passkeys are not linked accounts, so a user
// who only uses those sees the empty state. Google appears only when it is enabled.
import { headers } from 'next/headers';
import { getFormatter, getTranslations } from 'next-intl/server';

import { SettingSection } from '../../../../components/settings/setting-section.tsx';
import { getAuth } from '../../../../lib/auth.ts';

export interface ConnectedAccountView {
  id: string;
  providerId: string;
  /** ISO timestamp. */
  createdAt: string;
}

/** Providers that are sign-in methods a user can link (credential accounts are not shown). */
const LINKABLE = new Set(['google']);

export async function loadConnectedAccounts(): Promise<ConnectedAccountView[]> {
  const accounts = await getAuth().api.listUserAccounts({ headers: await headers() });
  return accounts
    .filter((account) => LINKABLE.has(account.providerId))
    .map((account) => ({
      id: account.id,
      providerId: account.providerId,
      createdAt: new Date(account.createdAt).toISOString(),
    }));
}

export async function ConnectedAccountsSection({ accounts }: { accounts: ConnectedAccountView[] }) {
  const [t, format] = await Promise.all([
    getTranslations('settings.account.connected'),
    getFormatter(),
  ]);
  return (
    <SettingSection id="connected-accounts" title={t('title')} description={t('description')}>
      {accounts.length === 0 ? (
        <p data-pattern-state="empty" className="text-ink-muted py-3 text-sm">
          {t('empty')}
        </p>
      ) : (
        <ul aria-label={t('listLabel')} className="divide-line flex flex-col divide-y">
          {accounts.map((account) => (
            <li
              key={account.id}
              data-provider={account.providerId}
              className="flex items-center justify-between gap-3 py-3"
            >
              <span className="text-sm font-medium">
                {account.providerId === 'google' ? t('providers.google') : account.providerId}
              </span>
              <span className="text-ink-muted text-xs">
                {t('connectedOn', {
                  date: format.dateTime(new Date(account.createdAt), { dateStyle: 'medium' }),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingSection>
  );
}
