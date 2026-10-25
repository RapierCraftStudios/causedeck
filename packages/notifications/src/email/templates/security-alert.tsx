// Security alert (category `security.alert`, mandatory: no unsubscribe link).
import { Button, Heading, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { Layout, styles } from './layout.tsx';

export interface SecurityAlertProps {
  title: string;
  body?: string | undefined;
  href: string;
}

export function securityAlertSubject(t: Translate, { title }: SecurityAlertProps): string {
  return t('securityAlert.subject', { title });
}

export function SecurityAlertEmail({
  t,
  lang,
  title,
  body,
  href,
}: SecurityAlertProps & { t: Translate; lang: string }) {
  return (
    <Layout t={t} lang={lang} preview={t('securityAlert.preview')}>
      <Heading as="h1" style={styles.heading}>
        {title}
      </Heading>
      <Text style={styles.text}>{t('securityAlert.intro')}</Text>
      {body === undefined ? null : <Text style={styles.text}>{body}</Text>}
      <Button href={href} style={styles.button}>
        {t('securityAlert.cta')}
      </Button>
      <Text style={styles.muted}>{t('securityAlert.help')}</Text>
    </Layout>
  );
}
