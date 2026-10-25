// Page chrome strings for the legal pages (#95). English is complete; ta and kn are stubs that fall
// back to English key by key until translations are supplied. Legal bodies are English only.
export type ChromeLocale = 'en' | 'ta' | 'kn';

export interface LegalChrome {
  draftBanner: string;
  draftBadge: string;
  version: string;
  effectiveDate: string;
  effectiveDatePending: string;
  lastUpdated: string;
  contents: string;
  close: string;
  versionHistory: string;
  languageNote: string;
  print: string;
  indexTitle: string;
  subprocessorColumns: {
    name: string;
    purpose: string;
    dataCategories: string;
    region: string;
    effectiveDate: string;
  };
  feedLink: string;
}

const en: LegalChrome = {
  draftBanner: 'Draft pending counsel review',
  draftBadge: 'Draft',
  version: 'Version',
  effectiveDate: 'Effective date',
  effectiveDatePending: 'Set when counsel approves',
  lastUpdated: 'Last updated',
  contents: 'On this page',
  close: 'Close',
  versionHistory: 'Version history',
  languageNote: 'This document is available in English only.',
  print: 'Print this page',
  indexTitle: 'Legal',
  subprocessorColumns: {
    name: 'Sub-processor',
    purpose: 'Purpose',
    dataCategories: 'Data categories',
    region: 'Region',
    effectiveDate: 'Effective date',
  },
  feedLink: 'Subscribe to changes (RSS)',
};

// TODO(translation): supply ta and kn chrome strings; until then every key falls back to English.
const stubs: Record<Exclude<ChromeLocale, 'en'>, Partial<LegalChrome>> = { ta: {}, kn: {} };

export function legalChrome(locale: ChromeLocale = 'en'): LegalChrome {
  return locale === 'en' ? en : { ...en, ...stubs[locale] };
}
