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
});
