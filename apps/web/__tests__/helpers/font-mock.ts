// next/font/local only works inside the Next.js compiler; tests get a stand-in that keeps the
// variable name and the font file, so locale-specific classes stay distinguishable.
interface LocalFontOptions {
  src: string | { path: string }[];
  variable?: string;
  preload?: boolean;
}

export const loadedFonts: LocalFontOptions[] = [];

export default function localFont(options: LocalFontOptions) {
  loadedFonts.push(options);
  const file = typeof options.src === 'string' ? options.src : (options.src[0]?.path ?? '');
  const name = file.split('/').pop()?.replace('.woff2', '') ?? 'font';
  return { className: `font-${name}`, variable: `var-${name}`, style: { fontFamily: name } };
}
