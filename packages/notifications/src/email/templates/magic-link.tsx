// Magic-link sign-in (auth). Transactional: no preferences link.
import { Button, Heading, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { FallbackLink, Layout, styles } from './layout.tsx';

export interface MagicLinkProps {
  url: string;
  expiresInMinutes: number;
}

export function magicLinkSubject(t: Translate): string {
  return t('magicLink.subject');
}

export function MagicLinkEmail({
  t,
  lang,
  url,
  expiresInMinutes,
}: MagicLinkProps & { t: Translate; lang: string }) {
  return (
    <Layout t={t} lang={lang} preview={t('magicLink.preview')}>
      <Heading as="h1" style={styles.heading}>
        {t('magicLink.heading')}
      </Heading>
      <Text style={styles.text}>{t('magicLink.body', { minutes: expiresInMinutes })}</Text>
      <Button href={url} style={styles.button}>
        {t('magicLink.cta')}
      </Button>
      <FallbackLink t={t} url={url} labelKey="magicLink.fallback" />
      <Text style={styles.muted}>{t('magicLink.ignore')}</Text>
    </Layout>
  );
}
