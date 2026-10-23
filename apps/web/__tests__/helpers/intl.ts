import { createTranslator } from 'next-intl';

import en from '@causedeck/i18n/messages/en.json';
import kn from '@causedeck/i18n/messages/kn.json';
import ta from '@causedeck/i18n/messages/ta.json';

export const catalogs = { en, ta, kn } as const;

export type TestLocale = keyof typeof catalogs;

/** A server-side `getTranslations` stand-in backed by the real catalogs. */
export function fakeGetTranslations(locale: TestLocale) {
  return (namespace?: string) =>
    Promise.resolve(
      createTranslator({
        locale,
        messages: catalogs[locale],
        ...(namespace === undefined ? {} : { namespace: namespace as never }),
      }) as unknown as (key: string, values?: Record<string, string>) => string,
    );
}
