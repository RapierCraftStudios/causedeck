// Self-hosted fonts from @causedeck/ui (packages/ui/fonts, SIL OFL 1.1) via next/font/local, so no
// request ever leaves for Google Fonts. Geist (interface) and Newsreader roman (headlines) are the
// critical, preloaded faces. The Tamil and Kannada faces are in the font stacks (globals.css) but
// the browser only downloads one when the page contains that script. Mirrors apps/web/app/fonts.ts.
import localFont from 'next/font/local';

const geist = localFont({
  src: '../../../packages/ui/fonts/geist-latin-wght.woff2',
  weight: '400 600',
  display: 'swap',
  variable: '--font-geist',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

const newsreader = localFont({
  src: '../../../packages/ui/fonts/newsreader-latin-wght.woff2',
  style: 'normal',
  weight: '400 600',
  display: 'swap',
  variable: '--font-newsreader',
  fallback: ['Georgia', 'serif'],
});

// `size-adjust: 96%` sets the Noto Sans letter body on the Geist x-height.
const notoTamil = localFont({
  src: '../../../packages/ui/fonts/noto-sans-tamil-wght.woff2',
  weight: '400 600',
  display: 'swap',
  preload: false,
  variable: '--font-tamil',
  adjustFontFallback: false,
  declarations: [{ prop: 'size-adjust', value: '96%' }],
});

const notoKannada = localFont({
  src: '../../../packages/ui/fonts/noto-sans-kannada-wght.woff2',
  weight: '400 600',
  display: 'swap',
  preload: false,
  variable: '--font-kannada',
  adjustFontFallback: false,
  declarations: [{ prop: 'size-adjust', value: '96%' }],
});

/** Class names for `<html>`. */
export const fontClassNames = [
  'cd-fonts',
  geist.variable,
  newsreader.variable,
  notoTamil.variable,
  notoKannada.variable,
].join(' ');
