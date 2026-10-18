// Self-hosted fonts from @causedeck/ui (packages/ui/fonts, SIL OFL 1.1) via next/font/local, so no
// request ever leaves for Google Fonts. next/font needs file paths relative to this module.
// The Latin faces are preloaded on every page; the Tamil and Kannada faces are never preloaded and
// are only wired into the font stacks (globals.css) when the locale is `ta` or `kn`.
import localFont from 'next/font/local';

import type { Locale } from '../i18n/routing.ts';

const geist = localFont({
  src: '../../../packages/ui/fonts/geist-latin-wght.woff2',
  weight: '400 600',
  display: 'swap',
  variable: '--font-geist',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

const newsreader = localFont({
  src: [
    { path: '../../../packages/ui/fonts/newsreader-latin-opsz-wght.woff2', style: 'normal' },
    { path: '../../../packages/ui/fonts/newsreader-latin-opsz-wght-italic.woff2', style: 'italic' },
  ],
  weight: '400 600',
  display: 'swap',
  variable: '--font-newsreader',
  fallback: ['Georgia', 'serif'],
});

const geistMono = localFont({
  src: '../../../packages/ui/fonts/geist-mono-latin-wght.woff2',
  weight: '400 600',
  display: 'swap',
  variable: '--font-geist-mono',
  fallback: ['ui-monospace', 'monospace'],
});

const notoTamil = localFont({
  src: '../../../packages/ui/fonts/noto-sans-tamil-wght.woff2',
  weight: '400 600',
  display: 'swap',
  preload: false,
  variable: '--font-indic',
  adjustFontFallback: false,
});

const notoKannada = localFont({
  src: '../../../packages/ui/fonts/noto-sans-kannada-wght.woff2',
  weight: '400 600',
  display: 'swap',
  preload: false,
  variable: '--font-indic',
  adjustFontFallback: false,
});

const INDIC: Partial<Record<Locale, string>> = {
  ta: notoTamil.variable,
  kn: notoKannada.variable,
};

/** Class names for `<html>`: Latin variables always, the Indic one only for `ta` / `kn`. */
export function fontClassNames(locale: Locale): string {
  return ['cd-fonts', geist.variable, newsreader.variable, geistMono.variable, INDIC[locale]]
    .filter(Boolean)
    .join(' ');
}
