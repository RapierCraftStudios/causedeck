/**
 * Locales, content language tags and formatters (en/ta/kn). Catalogs live in `src/messages` and are
 * loaded through `@causedeck/i18n/server`; this barrel stays free of message JSON.
 */
export const packageName: string = '@causedeck/i18n';

export * from './locales';
export * from './content-lang';
export * from './format/number';
export * from './format/currency';
export * from './format/date';
export * from './format/time';
export * from './format/relative';
export * from './format/list';
export * from './format/plural';
export * from './format/case-number';
export { NAMESPACES, type Namespace } from './catalog';
export type { Messages } from './generated/messages';
