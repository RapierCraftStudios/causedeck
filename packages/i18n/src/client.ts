// Client-safe entry: no catalogs and no Node imports. `t()` keys are typed through the app's
// next-intl `AppConfig` augmentation, which uses `Messages`.
export { useLocale, useTranslations } from 'next-intl';

export { createMissingKeyHandlers, type MissingKeyMode, type MissingKeyReport } from './missing';
export type { Messages } from './generated/messages';
