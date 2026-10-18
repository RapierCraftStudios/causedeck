import type { Decorator, Preview } from '@storybook/nextjs-vite';

import '../src/styles/globals.css';

export const THEMES = ['light', 'dark'] as const;
export const LOCALES = ['en', 'ta', 'kn'] as const;

/** Theme and locale live on <html>, exactly as in the apps (next-themes `attribute="class"`). */
const withThemeAndLocale: Decorator = (Story, context) => {
  const root = document.documentElement;
  root.classList.toggle('dark', context.globals['theme'] === 'dark');
  const locale = String(context.globals['locale'] ?? 'en');
  root.lang = (LOCALES as readonly string[]).includes(locale) ? locale : 'en';
  return <Story />;
};

const viewport = (name: string, width: number) => ({
  name,
  styles: { width: `${String(width)}px`, height: '900px' },
  type:
    width < 768 ? ('mobile' as const) : width < 1280 ? ('tablet' as const) : ('desktop' as const),
});

const preview: Preview = {
  tags: ['autodocs'],
  decorators: [withThemeAndLocale],
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
      description: 'Document language for Tamil and Kannada label checks',
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
    layout: 'centered',
    controls: { expanded: true },
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
