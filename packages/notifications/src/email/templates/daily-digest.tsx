// Daily digest (category `digest.daily`, non-mandatory). Items are composed by the caller (#196
// and later producers); this template only lays them out.
import { Button, Heading, Link, Section, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { Layout, styles } from './layout.tsx';

export interface DigestItem {
  title: string;
  href: string;
}

export interface DailyDigestProps {
  items: readonly DigestItem[];
  appUrl: string;
  preferencesUrl: string;
}

export function dailyDigestSubject(t: Translate): string {
  return t('dailyDigest.subject');
}

export function DailyDigestEmail({
  t,
  lang,
  items,
  appUrl,
  preferencesUrl,
}: DailyDigestProps & { t: Translate; lang: string }) {
  return (
    <Layout t={t} lang={lang} preview={t('dailyDigest.preview')} preferencesUrl={preferencesUrl}>
      <Heading as="h1" style={styles.heading}>
        {t('dailyDigest.heading')}
      </Heading>
      <Text style={styles.text}>
        {items.length === 0
          ? t('dailyDigest.empty')
          : t('dailyDigest.summary', { count: items.length })}
      </Text>
      {items.length === 0 ? null : (
        <Section>
          {items.map((item) => (
            <Text key={item.href} style={styles.text}>
              <Link href={item.href} style={styles.link}>
                {item.title}
              </Link>
            </Text>
          ))}
        </Section>
      )}
      <Button href={appUrl} style={styles.button}>
        {t('dailyDigest.cta')}
      </Button>
    </Layout>
  );
}
