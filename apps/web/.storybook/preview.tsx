import type { Decorator, Preview } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';

import en from '@causedeck/i18n/messages/en.json';
import kn from '@causedeck/i18n/messages/kn.json';
import ta from '@causedeck/i18n/messages/ta.json';

import './storybook.css';

export const THEMES = ['light', 'dark'] as const;
const CATALOGS = { en, ta, kn } as const;
type Locale = keyof typeof CATALOGS;
export const LOCALES = Object.keys(CATALOGS) as Locale[];

const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && value in CATALOGS;

/**
 * Theme and locale live on <html>, exactly as in the app (next-themes `attribute="class"`), and
 * every story renders inside the real message catalog of the toolbar locale, as the app layout does.
 */
const withThemeAndIntl: Decorator = (Story, context) => {
  const root = document.documentElement;
  root.classList.toggle('dark', context.globals['theme'] === 'dark');
  const locale = isLocale(context.globals['locale']) ? context.globals['locale'] : 'en';
  root.lang = locale;
  return (
    <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]} timeZone="Asia/Kolkata">
      <Story />
    </NextIntlClientProvider>
  );
};

const viewport = (name: string, width: number) => ({
  name,
  styles: { width: `${String(width)}px`, height: '900px' },
  type:
    width < 768 ? ('mobile' as const) : width < 1280 ? ('tablet' as const) : ('desktop' as const),
});

const preview: Preview = {
  tags: ['autodocs'],
  decorators: [withThemeAndIntl],
  globalTypes: {
    theme: {
      description: 'Colour theme (toggles `.dark` on <html>)',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'App locale: message catalog and document language',
      toolbar: {
        title: 'Locale',
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'ta', title: 'தமிழ் (Tamil)' },
          { value: 'kn', title: 'ಕನ್ನಡ (Kannada)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light', locale: 'en' },
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    // App Router navigation mocks (useRouter, usePathname, next/link) from @storybook/nextjs-vite.
    nextjs: { appDirectory: true },
    viewport: {
      options: {
        mobile: viewport('Mobile 360', 360),
        tablet: viewport('Tablet 768', 768),
        desktop: viewport('Desktop 1280', 1280),
      },
    },
    // Fail interaction tests on any axe violation (so zero serious or critical, in both themes).
    a11y: { test: 'error' },
  },
};

export default preview;
