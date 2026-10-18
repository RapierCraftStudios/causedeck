// WCAG 2.x and APCA contrast for every foreground/background pair in both themes.
//
//   pnpm --filter @causedeck/ui check:contrast
//
// Exits 1 when text is below 4.5:1 or large text / UI is below 3:1. Body text below 7:1 (AAA) is
// reported as a warning. APCA Lc is printed for reference only; WCAG 2.x is the gate.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APCAcontrast, sRGBtoY } from 'apca-w3';
import { clampChroma, converter, parse, wcagContrast, type Color } from 'culori';

import { LEVELS, STAGES, loadThemes, resolveValue, type TokenMap } from './lib/parse-tokens';

/** body: primary reading text (AA gate, AAA warn). text: other text (AA). ui/large: 3:1. */
export type PairKind = 'body' | 'text' | 'large' | 'ui';

export interface ContrastPair {
  fg: string;
  bg: string;
  kind: PairKind;
}

export const THRESHOLDS: Record<PairKind, { min: number; warn?: number }> = {
  body: { min: 4.5, warn: 7 },
  text: { min: 4.5 },
  large: { min: 3 },
  ui: { min: 3 },
};

const SURFACES = ['surface', 'surface-raised', 'surface-sunken', 'surface-overlay'];
const READING_SURFACES = ['surface', 'surface-raised', 'surface-overlay'];
const STATUSES = ['success', 'warning', 'danger', 'info'];

const on = (fgs: string[], bgs: string[], kind: PairKind): ContrastPair[] =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, kind })));

/** Every pair the design language allows. Adding a role means adding its pairs here. */
export const CONTRAST_PAIRS: ContrastPair[] = [
  ...on(['ink'], [...SURFACES, 'accent-soft'], 'body'),
  ...on(['ink-muted', 'ink-subtle'], SURFACES, 'text'),
  ...on(['accent'], READING_SURFACES, 'text'),
  { fg: 'accent-ink', bg: 'accent', kind: 'text' },
  ...STATUSES.flatMap((s) => [
    ...on([s], READING_SURFACES, 'text'),
    { fg: s, bg: `${s}-soft`, kind: 'text' as const },
    { fg: 'ink', bg: `${s}-soft`, kind: 'text' as const },
  ]),
  ...on(['seal'], READING_SURFACES, 'ui'),
  // Focus ring must stand out from both surfaces it can sit between.
  ...on(['ring'], READING_SURFACES, 'ui'),
  // Form control boundaries (inputs, checkboxes). Hairlines (`line`, `line-strong`) are decorative.
  ...on(['line-control'], READING_SURFACES, 'ui'),
  ...STAGES.flatMap((s) => [
    { fg: `stage-${s}`, bg: `stage-${s}-soft`, kind: 'text' as const },
    { fg: `stage-${s}`, bg: 'surface-raised', kind: 'text' as const },
    { fg: 'ink', bg: `stage-${s}-soft`, kind: 'text' as const },
  ]),
  ...on(
    LEVELS.map((l) => `level-${l}`),
    READING_SURFACES,
    'ui',
  ),
  ...on(
    Array.from({ length: 8 }, (_, i) => `chart-${String(i + 1)}`),
    ['surface-raised'],
    'ui',
  ),
];

export interface ContrastResult extends ContrastPair {
  theme: 'light' | 'dark';
  ratio: number;
  apca: number;
  status: 'pass' | 'warn' | 'fail';
}

const toRgb = converter('rgb');

/** Parse a token value to an in-gamut sRGB colour, compositing any alpha over `backdrop`. */
export function toColor(value: string, backdrop?: Color): Color {
  const parsed = parse(value);
  if (!parsed) throw new Error(`cannot parse colour ${value}`);
  const rgb = toRgb(clampChroma(parsed, 'oklch'));
  const alpha = rgb.alpha ?? 1;
  if (alpha >= 1 || !backdrop) return { ...rgb, alpha: 1 };
  const b = toRgb(backdrop);
  return {
    mode: 'rgb',
    r: rgb.r * alpha + b.r * (1 - alpha),
    g: rgb.g * alpha + b.g * (1 - alpha),
    b: rgb.b * alpha + b.b * (1 - alpha),
  };
}

const to255 = (c: Color): number[] => {
  const { r, g, b } = toRgb(c);
  return [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
};

export function colorOf(name: string, theme: TokenMap, backdrop?: Color): Color {
  return toColor(resolveValue(`var(--${name})`, theme), backdrop);
}

export function evaluateContrast(
  themes: { light: TokenMap; dark: TokenMap } = loadThemes(),
  pairs: ContrastPair[] = CONTRAST_PAIRS,
): ContrastResult[] {
  const results: ContrastResult[] = [];
  for (const theme of ['light', 'dark'] as const) {
    const map = themes[theme];
    const canvas = colorOf('surface', map);
    for (const pair of pairs) {
      const bg = colorOf(pair.bg, map, canvas);
      const fg = colorOf(pair.fg, map, bg);
      const ratio = Math.round(wcagContrast(fg, bg) * 100) / 100;
      const apca = Math.round(
        Math.abs(Number(APCAcontrast(sRGBtoY(to255(fg)), sRGBtoY(to255(bg))))),
      );
      const { min, warn } = THRESHOLDS[pair.kind];
      const status = ratio < min ? 'fail' : warn !== undefined && ratio < warn ? 'warn' : 'pass';
      results.push({ ...pair, theme, ratio, apca, status });
    }
  }
  return results;
}

function main(): void {
  const results = evaluateContrast();
  const rows = results.map(
    (r) =>
      `${r.status.toUpperCase().padEnd(5)} ${r.theme.padEnd(5)} ${r.kind.padEnd(5)} ` +
      `${`${r.fg} on ${r.bg}`.padEnd(46)} ${r.ratio.toFixed(2).padStart(6)}:1  Lc ${String(r.apca)}`,
  );
  console.log(rows.join('\n'));
  const fails = results.filter((r) => r.status === 'fail');
  const warns = results.filter((r) => r.status === 'warn');
  console.log(
    `\n${String(results.length)} pairs: ${String(fails.length)} below AA, ${String(warns.length)} body pairs below AAA 7:1.`,
  );
  if (fails.length > 0) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
