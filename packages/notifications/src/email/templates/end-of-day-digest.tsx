// End-of-day digest, "What CauseDeck did today" (category `digest.end_of_day`, #49). Counts only
// unless the member turned names on. Both links only open the app; nothing in the email changes
// anything, and it carries no document content. Tamil and Kannada strings come from the same keys
// as English; the font stack falls back to Noto Sans Tamil and Kannada (layout.tsx).
import { Button, Heading, Link, Section, Text } from '@react-email/components';

import type { Translate } from '../messages.ts';
import { BRAND, Layout, styles } from './layout.tsx';

export interface EndOfDayDigestProps {
  /** L3 actions of the day that can still be undone. */
  l3Count: number;
  /** Open proposals that wait for the member. */
  pendingL2Count: number;
  /** Absolute links that open the app (the feed on that day, the inbox). */
  activityUrl: string;
  inboxUrl: string;
  /** Present only when the member opted into names. */
  matterTitles?: readonly string[] | undefined;
  preferencesUrl: string;
}

export function endOfDayDigestSubject(t: Translate): string {
  return t('endOfDayDigest.subject');
}

// Dark mode for the clients that honour it; the inline light values stay the default elsewhere.
const DARK_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .cd-card { background-color: #1c212b !important; border-color: #2d3340 !important; }
  .cd-ink { color: #e8eaee !important; }
  .cd-muted { color: #a3a8b3 !important; }
}`;

export function EndOfDayDigestEmail({
  t,
  lang,
  l3Count,
  pendingL2Count,
  activityUrl,
  inboxUrl,
  matterTitles,
  preferencesUrl,
}: EndOfDayDigestProps & { t: Translate; lang: string }) {
  const names = matterTitles ?? [];
  return (
    <Layout t={t} lang={lang} preview={t('endOfDayDigest.preview')} preferencesUrl={preferencesUrl}>
      <style>{DARK_CSS}</style>
      <Heading as="h1" style={styles.heading} className="cd-ink">
        {t('endOfDayDigest.heading')}
      </Heading>
      <Text style={styles.text} className="cd-ink">
        {t('endOfDayDigest.applied', { count: l3Count })}
      </Text>
      <Text style={styles.text} className="cd-ink">
        {t('endOfDayDigest.pending', { count: pendingL2Count })}
      </Text>
      {names.length === 0 ? null : (
        <Section>
          <Text style={styles.muted} className="cd-muted">
            {t('endOfDayDigest.matters')}
          </Text>
          {names.map((title) => (
            <Text key={title} style={styles.text} className="cd-ink">
              {title}
            </Text>
          ))}
        </Section>
      )}
      <Button href={activityUrl} style={styles.button}>
        {t('endOfDayDigest.activityCta')}
      </Button>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }} className="cd-muted">
        <Link href={inboxUrl} style={{ color: BRAND.accent }}>
          {t('endOfDayDigest.inboxCta')}
        </Link>
      </Text>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }} className="cd-muted">
        {t('endOfDayDigest.note')}
      </Text>
    </Layout>
  );
}
