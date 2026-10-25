// OutcomeMissing email (category `reminder.outcome_missing`, #64): counts only, no party
// names, one short paragraph and one button that opens the app. Sent only to the member.
import { Button, Heading, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { Layout, styles } from './layout.tsx';

export interface OutcomeMissingProps {
  count: number;
  /** Absolute link that opens the app. */
  url: string;
  preferencesUrl: string;
}

export function outcomeMissingSubject(t: Translate): string {
  return t('reminders.email.outcomeMissing.subject');
}

export function OutcomeMissingEmail({
  t,
  lang,
  url,
  preferencesUrl,
  ...counts
}: OutcomeMissingProps & { t: Translate; lang: string }) {
  return (
    <Layout
      t={t}
      lang={lang}
      preview={t('reminders.email.outcomeMissing.preview')}
      preferencesUrl={preferencesUrl}
    >
      <Heading as="h1" style={{ ...styles.heading, fontFamily: 'Georgia, "Times New Roman", serif' }}>
        {t('reminders.email.outcomeMissing.heading')}
      </Heading>
      <Text style={styles.text}>{t('reminders.email.outcomeMissing.body', counts)}</Text>
      <Button href={url} style={styles.button}>
        {t('reminders.email.outcomeMissing.cta')}
      </Button>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }}>{t('reminders.email.note')}</Text>
    </Layout>
  );
}
