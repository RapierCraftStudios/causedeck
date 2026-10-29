// Copy layer for the marketing pages (#91). `en` is complete; `ta` and `kn` are stubs until
// counsel-reviewed translations exist, so every missing key falls back to English.
export type CopyLocale = 'en' | 'ta' | 'kn';

export function resolveCopy<T extends object>(
  catalogue: Record<CopyLocale, Partial<T>> & { en: T },
  locale: CopyLocale = 'en',
): T {
  return { ...catalogue.en, ...catalogue[locale] };
}
