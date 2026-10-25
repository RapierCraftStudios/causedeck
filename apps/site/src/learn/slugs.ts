// The practice-school modules, in teaching order, and the locales they ship in. The locale list
// mirrors `@causedeck/i18n/locales`; the site does not depend on that package.
export const LEARN_SLUGS = [
  'court-day-practice',
  'reading-cause-lists',
  'listings-and-mentions',
  'filing-and-defect-cures',
  'limitation-basics',
  'using-the-os',
] as const;
export type LearnSlug = (typeof LEARN_SLUGS)[number];

export const LEARN_LOCALES = ['en', 'ta', 'kn'] as const;
export type LearnLocale = (typeof LEARN_LOCALES)[number];
