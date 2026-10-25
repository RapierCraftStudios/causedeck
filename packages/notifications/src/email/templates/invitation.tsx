// Workspace invitation (category `workspace.invite`, non-mandatory: links to preferences).
import { Button, Heading, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { FallbackLink, Layout, styles } from './layout.tsx';

export interface InvitationProps {
  url: string;
  expiresInDays: number;
  preferencesUrl: string;
}

export function invitationSubject(t: Translate): string {
  return t('invitation.subject');
}

export function InvitationEmail({
  t,
  lang,
  url,
  expiresInDays,
  preferencesUrl,
}: InvitationProps & { t: Translate; lang: string }) {
  return (
    <Layout t={t} lang={lang} preview={t('invitation.preview')} preferencesUrl={preferencesUrl}>
      <Heading as="h1" style={styles.heading}>
        {t('invitation.heading')}
      </Heading>
      <Text style={styles.text}>{t('invitation.body', { days: expiresInDays })}</Text>
      <Button href={url} style={styles.button}>
        {t('invitation.cta')}
      </Button>
      <FallbackLink t={t} url={url} labelKey="invitation.fallback" />
      <Text style={styles.muted}>{t('invitation.ignore')}</Text>
    </Layout>
  );
}
