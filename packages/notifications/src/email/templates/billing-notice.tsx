// Billing notice (category `billing.notice`, non-mandatory: links to preferences).
import { Button, Heading, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { Layout, styles } from './layout.tsx';

export interface BillingNoticeProps {
  title: string;
  body?: string | undefined;
  href: string;
  preferencesUrl: string;
}

export function billingNoticeSubject(t: Translate, { title }: BillingNoticeProps): string {
  return t('billingNotice.subject', { title });
}

export function BillingNoticeEmail({
  t,
  lang,
  title,
  body,
  href,
  preferencesUrl,
}: BillingNoticeProps & { t: Translate; lang: string }) {
  return (
    <Layout t={t} lang={lang} preview={t('billingNotice.preview')} preferencesUrl={preferencesUrl}>
      <Heading as="h1" style={styles.heading}>
        {title}
      </Heading>
      {body === undefined ? null : <Text style={styles.text}>{body}</Text>}
      <Button href={href} style={styles.button}>
        {t('billingNotice.cta')}
      </Button>
    </Layout>
  );
}
