// Generic member notification (#196): the email for every category without a dedicated template
// (member joined, hearing reminders, new proposals, system notices). Non-mandatory: links to
// preferences.
import { Button, Heading, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { Layout, styles } from './layout.tsx';

export interface NoticeProps {
  title: string;
  body?: string | undefined;
  href: string;
  preferencesUrl: string;
}

export function noticeSubject(t: Translate, { title }: NoticeProps): string {
  return t('notice.subject', { title });
}

export function NoticeEmail({
  t,
  lang,
  title,
  body,
  href,
  preferencesUrl,
}: NoticeProps & { t: Translate; lang: string }) {
  return (
    <Layout t={t} lang={lang} preview={t('notice.preview')} preferencesUrl={preferencesUrl}>
      <Heading as="h1" style={styles.heading}>
        {title}
      </Heading>
      {body === undefined ? null : <Text style={styles.text}>{body}</Text>}
      <Button href={href} style={styles.button}>
        {t('notice.cta')}
      </Button>
    </Layout>
  );
}
