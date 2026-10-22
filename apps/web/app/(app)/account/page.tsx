// `/account` (#289): the signed-in user's own profile and security, not workspace-scoped. Profile
// (name, initials avatar, email, language), Security (passkeys, two-factor authentication,
// active sessions and connected accounts) and the Danger zone with `Delete account` (#305). Data
// comes from Better Auth for the session's user only; every change goes through the account server
// actions (`./actions.ts`).
//
// States: loading (skeleton cards while the sections stream in), error (`Could not load your
// account.` with `Try again`), empty (no passkeys, no other sessions, no connected accounts),
// offline (the settings banner; controls turn read-only) and permission-denied (an action on
// anything that is not the caller's own returns FORBIDDEN, shown as `You can only manage your own
// account.`). `?__state=loading|error` previews the first two in development.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { isDev } from '../../../lib/env.ts';
import { getAuth } from '../../../lib/auth.ts';
import { logger } from '../../../src/health.ts';

import {
  requestAccountDeletionAction,
  updateAccountProfileAction,
  verifyTwoFactorAction,
} from './actions.ts';
import { DeleteAccount } from './danger/delete-account.tsx';
import { AccountError } from './error.tsx';
import { AccountProfileForm, AccountSkeleton } from './profile/profile-form.tsx';
import { ConnectedAccountsSection, loadConnectedAccounts } from './security/connected-accounts.tsx';
import { loadPasskeys, PasskeysSection } from './security/passkeys.tsx';
import { loadSessions, SessionsSection } from './security/sessions.tsx';
import { TwoFactorSection } from './security/two-factor.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.account');
  return { title: t('metaTitle') };
}

/** `?__state=loading|error` previews a state in development. Ignored in production. */
function devState(searchParams: SearchParams): string | undefined {
  if (!isDev()) return undefined;
  const value = searchParams.__state;
  return Array.isArray(value) ? value[0] : value;
}

interface AccountUser {
  name: string;
  email: string;
  twoFactorEnabled: boolean;
  sessionId: string;
}

async function loadUser(): Promise<AccountUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    name: session.user.name,
    email: session.user.email,
    // Added by the two-factor plugin; not in the base user type.
    twoFactorEnabled:
      (session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
    sessionId: session.session.id,
  };
}

async function AccountSections({ state }: { state: string | undefined }) {
  let user: AccountUser | null;
  let data: Awaited<ReturnType<typeof loadSecurity>> | null;
  try {
    if (state === 'error') throw new Error('Account error state (dev toggle)');
    user = await loadUser();
    data = user ? await loadSecurity(user.sessionId) : null;
  } catch (error) {
    if (state !== 'error') logger.error({ err: error }, 'account page: could not load account');
    return <AccountError />;
  }
  // The session ended between the layout check and this read.
  if (!user || !data) redirect('/sign-in?next=%2Faccount');
  const t = await getTranslations('settings.account');
  return (
    <>
      <div id="profile" className="scroll-mt-4">
        <AccountProfileForm name={user.name} email={user.email} save={updateAccountProfileAction} />
      </div>
      <div id="security" className="flex scroll-mt-4 flex-col gap-4">
        <header className="flex flex-col gap-1 pt-2">
          <h2 className="font-serif text-xl font-medium">{t('security.title')}</h2>
          <p className="text-ink-muted text-sm">{t('security.description')}</p>
        </header>
        <PasskeysSection passkeys={data.passkeys} />
        <TwoFactorSection enabled={user.twoFactorEnabled} />
        <SessionsSection sessions={data.sessions} />
        <ConnectedAccountsSection accounts={data.accounts} />
      </div>
      <div id="danger" className="scroll-mt-4">
        <DeleteAccount
          email={user.email}
          twoFactorEnabled={user.twoFactorEnabled}
          requestDeletion={requestAccountDeletionAction}
          verifyCode={verifyTwoFactorAction}
        />
      </div>
    </>
  );
}

async function loadSecurity(sessionId: string) {
  const [passkeys, sessions, accounts] = await Promise.all([
    loadPasskeys(),
    loadSessions(sessionId),
    loadConnectedAccounts(),
  ]);
  return { passkeys, sessions, accounts };
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const state = devState(await searchParams);
  return (
    <div data-route="account" className="flex flex-col gap-6">
      {state === 'loading' ? (
        <AccountSkeleton />
      ) : (
        <Suspense fallback={<AccountSkeleton />}>
          <AccountSections state={state} />
        </Suspense>
      )}
    </div>
  );
}
