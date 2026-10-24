// The legal news digest (category `digest.news`, #481). Headlines with the publisher's name and a
// link to the original article; the excerpt is the feed's own, never article text. Nothing in the
// email changes anything.
import { Button, Heading, Link, Section, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { BRAND, Layout, styles } from './layout.tsx';

export interface NewsDigestItem {
  title: string;
  /** The original article. */
  url: string;
  /** Attribution: who published it. */
  sourceName: string;
  excerpt?: string | null | undefined;
}

export interface NewsDigestProps {
  items: readonly NewsDigestItem[];
  /** Absolute link to the News page. */
  newsUrl: string;
  preferencesUrl: string;
}

export function newsDigestSubject(t: Translate): string {
  return t('newsDigest.subject');
}

export function NewsDigestEmail({
  t,
  lang,
  items,
  newsUrl,
  preferencesUrl,
}: NewsDigestProps & { t: Translate; lang: string }) {
  return (
    <Layout t={t} lang={lang} preview={t('newsDigest.preview')} preferencesUrl={preferencesUrl}>
      <Heading as="h1" style={styles.heading}>
        {t('newsDigest.heading')}
      </Heading>
      {items.map((item) => (
        <Section key={item.url}>
          <Text style={{ ...styles.text, margin: '16px 0 0', fontWeight: 600 }}>
            <Link href={item.url} style={{ color: BRAND.accent }}>
              {item.title}
            </Link>
          </Text>
          <Text style={{ ...styles.muted, margin: '2px 0 0' }}>
            {t('newsDigest.source', { source: item.sourceName })}
          </Text>
          {item.excerpt ? <Text style={styles.text}>{item.excerpt}</Text> : null}
        </Section>
      ))}
      <Button href={newsUrl} style={styles.button}>
        {t('newsDigest.cta')}
      </Button>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }}>{t('newsDigest.note')}</Text>
    </Layout>
  );
}
