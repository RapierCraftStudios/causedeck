// MorningDiff email (category `reminder.morning`, #64): counts only, no party
// names, one short paragraph and one button that opens the app. Sent only to the member.
import { Button, Heading, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { Layout, styles } from './layout.tsx';

export interface MorningDiffProps {
  added: number;
  moved: number;
  removed: number;
  /** Absolute link that opens the app. */
  url: string;
  preferencesUrl: string;
}

export function morningDiffSubject(t: Translate): string {
  return t('reminders.email.morning.subject');
}

export function MorningDiffEmail({
  t,
  lang,
  url,
  preferencesUrl,
  ...counts
}: MorningDiffProps & { t: Translate; lang: string }) {
  return (
    <Layout
      t={t}
      lang={lang}
      preview={t('reminders.email.morning.preview')}
      preferencesUrl={preferencesUrl}
    >
      <Heading as="h1" style={{ ...styles.heading, fontFamily: 'Georgia, "Times New Roman", serif' }}>
        {t('reminders.email.morning.heading')}
      </Heading>
      <Text style={styles.text}>{t('reminders.email.morning.body', counts)}</Text>
      <Button href={url} style={styles.button}>
        {t('reminders.email.morning.cta')}
      </Button>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }}>{t('reminders.email.note')}</Text>
    </Layout>
  );
}
