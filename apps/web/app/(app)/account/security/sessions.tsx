// Account sessions section (#289): the caller's active sessions (`listSessions`, scoped to the
// session's user) as `SessionView`s. Only ids go to the browser, never session tokens.
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { SessionList, type SessionView } from '../../../../components/settings/session-list.tsx';
import { SettingSection } from '../../../../components/settings/setting-section.tsx';
import { getAuth } from '../../../../lib/auth.ts';
import { revokeSessionAction } from '../actions.ts';

export async function loadSessions(currentSessionId: string): Promise<SessionView[]> {
  const sessions = await getAuth().api.listSessions({ headers: await headers() });
  return sessions
    .map((session) => ({
      id: session.id,
      userAgent: session.userAgent ?? null,
      ipAddress: session.ipAddress ?? null,
      createdAt: new Date(session.createdAt).toISOString(),
      current: session.id === currentSessionId,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function SessionsSection({ sessions }: { sessions: SessionView[] }) {
  const t = await getTranslations('settings.account.sessions');
  return (
    <SettingSection id="sessions" title={t('title')} description={t('description')}>
      <SessionList sessions={sessions} revokeSession={revokeSessionAction} />
    </SettingSection>
  );
}
