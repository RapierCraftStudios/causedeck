import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { defaultLocale, locales } from '../i18n/routing.ts';

import { catalogs } from './helpers/intl.ts';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('message catalogs', () => {
  it('cover en, ta and kn with en as the default', () => {
    expect([...locales]).toEqual(['en', 'ta', 'kn']);
    expect(defaultLocale).toBe('en');
  });

  it.each(['ta', 'kn'] as const)('%s.json has the same key set as en.json', (locale) => {
    expect(keys(catalogs[locale]).sort()).toEqual(keys(catalogs.en).sort());
  });

  it.each(['ta', 'kn'] as const)('%s stub strings render through next-intl', (locale) => {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: 'home' });
    expect(t('tagline')).toBe(catalogs[locale].home.tagline);
    expect(t('tagline')).not.toBe(catalogs.en.home.tagline);
  });

  it('formats ICU arguments', () => {
    const t = createTranslator({ locale: 'en', messages: catalogs.en, namespace: 'error' });
    expect(t('reference', { digest: 'abc123' })).toBe('Reference: abc123');
  });

  it('carries the designed offline and home copy', () => {
    expect(catalogs.en.offline.body).toBe(
      'You are offline. Saved court days and briefs remain available once synced.',
    );
    expect(catalogs.en.home.tagline).toBe('Your court day, prepared.');
  });

  it('carries the designed sign-in copy (#153)', () => {
    const { signIn, checkEmail } = catalogs.en.auth;
    expect(signIn.title).toBe('Sign in to CauseDeck');
    expect(signIn.tagline).toBe('Your court day, prepared.');
    expect(signIn.google).toBe('Continue with Google');
    expect(signIn.passkey).toBe('Use a passkey');
    expect(signIn.submit).toBe('Email me a sign-in link');
    expect(signIn.sending).toBe('Sending...');
    expect(signIn.hosted).toBe('India-hosted. Your matter data never leaves India.');
    expect(signIn.errors).toMatchObject({
      sendFailed: 'We could not send the link. Try again in a moment.',
      expired: 'This link has expired. Request a new one.',
      offline: 'You are offline. Connect to sign in.',
      accessDenied: 'Access was not granted.',
    });
    expect(checkEmail.title).toBe('Check your email');
    const t = createTranslator({ locale: 'en', messages: catalogs.en, namespace: 'auth' });
    expect(t('checkEmail.body', { email: 'name@example.com', minutes: 10 })).toBe(
      'We sent a sign-in link to name@example.com. It expires in 10 minutes.',
    );
    expect(t('checkEmail.differentEmail')).toBe('Use a different email');
    expect(t('checkEmail.resend')).toBe('Resend');
  });

  it('keeps the auth copy calm: no exclamation marks', () => {
    for (const locale of locales) {
      expect(keys(catalogs[locale].auth).length).toBeGreaterThan(0);
      expect(JSON.stringify(catalogs[locale].auth)).not.toContain('!');
    }
  });

  it.each(['ta', 'kn'] as const)('%s auth strings keep the ICU arguments of en', (locale) => {
    const args = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const pick = (catalog: unknown, key: string): string =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)[part],
          catalog,
        ) as string;
    for (const key of keys(catalogs.en.auth)) {
      expect(args(pick(catalogs[locale].auth, key)), key).toEqual(
        args(pick(catalogs.en.auth, key)),
      );
    }
  });
});
