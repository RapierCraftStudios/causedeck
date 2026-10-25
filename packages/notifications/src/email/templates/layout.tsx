// Shared email layout. Brand colours are literal values of the design tokens in
// packages/ui/tokens/semantic.css (email clients do not support CSS variables). No images: the
// brand is text, so there is nothing remote to load and no tracking pixel.
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

import type { Translate } from '../messages.ts';

/** Light-theme token values, converted from OKLCH. */
export const BRAND = {
  surface: '#fbfaf7', // --surface
  surfaceRaised: '#fffefd', // --surface-raised
  ink: '#161b24', // --ink
  inkMuted: '#535862', // --ink-muted
  line: '#e5e3dd', // --line
  accent: '#3050aa', // --accent
  accentInk: '#fcfcfc', // --accent-ink
} as const;

export const FONT_STACK =
  "'Noto Sans', 'Noto Sans Tamil', 'Noto Sans Kannada', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export const styles = {
  heading: { color: BRAND.ink, fontSize: '20px', fontWeight: 600, margin: '0 0 16px' },
  text: { color: BRAND.ink, fontSize: '15px', lineHeight: '24px', margin: '0 0 16px' },
  muted: { color: BRAND.inkMuted, fontSize: '13px', lineHeight: '20px', margin: '0 0 12px' },
  button: {
    backgroundColor: BRAND.accent,
    borderRadius: '6px',
    color: BRAND.accentInk,
    display: 'inline-block',
    fontSize: '15px',
    fontWeight: 600,
    padding: '12px 20px',
    textDecoration: 'none',
  },
  link: { color: BRAND.accent, wordBreak: 'break-all' as const },
} as const;

export interface LayoutProps {
  t: Translate;
  lang: string;
  preview: string;
  /** Present for non-mandatory categories: the footer links to notification preferences. */
  preferencesUrl?: string | undefined;
  children: ReactNode;
}

export function Layout({ t, lang, preview, preferencesUrl, children }: LayoutProps) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: BRAND.surface, fontFamily: FONT_STACK, margin: 0 }}>
        <Container style={{ maxWidth: '560px', padding: '32px 16px' }}>
          <Text
            style={{ color: BRAND.accent, fontSize: '18px', fontWeight: 700, margin: '0 0 24px' }}
          >
            {t('layout.brand')}
          </Text>
          <Section
            style={{
              backgroundColor: BRAND.surfaceRaised,
              border: `1px solid ${BRAND.line}`,
              borderRadius: '8px',
              padding: '24px',
            }}
          >
            {children}
          </Section>
          <Hr style={{ borderColor: BRAND.line, margin: '24px 0 16px' }} />
          <Text style={styles.muted}>{t('layout.footer')}</Text>
          {preferencesUrl === undefined ? (
            <Text style={styles.muted}>{t('layout.mandatory')}</Text>
          ) : (
            <Text style={styles.muted}>
              <Link href={preferencesUrl} style={styles.link} data-preferences-link="true">
                {t('layout.preferences')}
              </Link>
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}

/** The bare URL on its own line, so the plain-text part (and e2e) can read it. */
export function FallbackLink({
  t,
  url,
  labelKey,
}: {
  t: Translate;
  url: string;
  labelKey: string;
}) {
  return (
    <>
      <Text style={styles.muted}>{t(labelKey)}</Text>
      <Text style={styles.muted}>
        <Link href={url} style={styles.link}>
          {url}
        </Link>
      </Text>
    </>
  );
}
