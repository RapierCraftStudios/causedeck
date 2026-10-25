// EveningBrief email (category `reminder.evening`, #64): counts only, no party
// names, one short paragraph and one button that opens the app. Sent only to the member.
import { Button, Heading, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { Layout, styles } from './layout.tsx';

export interface EveningBriefProps {
  listings: number;
  halls: number;
  clashes: number;
  lowReadiness: number;
  obligations: number;
  /** Absolute link that opens the app. */
  url: string;
  preferencesUrl: string;
}

export function eveningBriefSubject(t: Translate): string {
  return t('reminders.email.evening.subject');
}

export function EveningBriefEmail({
  t,
  lang,
  url,
  preferencesUrl,
  ...counts
}: EveningBriefProps & { t: Translate; lang: string }) {
  return (
    <Layout
      t={t}
      lang={lang}
      preview={t('reminders.email.evening.preview')}
      preferencesUrl={preferencesUrl}
    >
      <Heading
        as="h1"
        style={{ ...styles.heading, fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        {t('reminders.email.evening.heading')}
      </Heading>
      <Text style={styles.text}>{t('reminders.email.evening.body', counts)}</Text>
      <Button href={url} style={styles.button}>
        {t('reminders.email.evening.cta')}
      </Button>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }}>{t('reminders.email.note')}</Text>
    </Layout>
  );
}
