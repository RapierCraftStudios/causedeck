import { DEFAULT_LOCALE, LOCALE_BCP47, type Locale } from '../locales';

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/** ICU plural category of `n` in `locale` (ta and kn have `one` and `other`). */
export function pluralCategory(n: number, locale: Locale = DEFAULT_LOCALE): Intl.LDMLPluralRule {
  return new Intl.PluralRules(LOCALE_BCP47[locale]).select(n);
}

/** Picks the form for `n`, falling back to `other`. */
export function selectPlural(
  n: number,
  forms: PluralForms,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return forms[pluralCategory(n, locale)] ?? forms.other;
}
