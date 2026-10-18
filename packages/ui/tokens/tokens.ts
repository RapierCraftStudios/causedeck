// Typed mirror of the CSS tokens for JavaScript consumers (charts, the motion library).
// Colours resolve to `var(--token)` strings, so theming stays pure CSS: no runtime JS is needed
// to switch themes. tokens/__tests__/tokens.test.ts fails if this file drifts from the CSS.

export const COLOR_TOKENS = [
  'surface',
  'surface-raised',
  'surface-sunken',
  'surface-overlay',
  'ink',
  'ink-muted',
  'ink-subtle',
  'line',
  'line-strong',
  'line-control',
  'accent',
  'accent-ink',
  'accent-soft',
  'seal',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
  'danger',
  'danger-soft',
  'info',
  'info-soft',
  'ring',
  'stage-filed',
  'stage-filed-soft',
  'stage-sr_fr',
  'stage-sr_fr-soft',
  'stage-defects',
  'stage-defects-soft',
  'stage-re_presented',
  'stage-re_presented-soft',
  'stage-numbered',
  'stage-numbered-soft',
  'stage-disposed',
  'stage-disposed-soft',
  'stage-listed',
  'stage-listed-soft',
  'stage-reserved',
  'stage-reserved-soft',
  'stage-part-heard',
  'stage-part-heard-soft',
  'level-l1',
  'level-l2',
  'level-l3',
  'level-l4',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-8',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

type CssVar<T extends string> = `var(--${T})`;

const cssVar = <T extends string>(name: T): CssVar<T> => `var(--${name})`;

export const color = Object.fromEntries(COLOR_TOKENS.map((name) => [name, cssVar(name)])) as {
  readonly [K in ColorToken]: CssVar<K>;
};

/** Durations in milliseconds; under reduced motion the CSS variables become 0.01ms. */
export const motion = {
  duration: {
    instant: 80,
    fast: 150,
    base: 200,
    slow: 250,
    page: 320,
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
    enter: 'cubic-bezier(0, 0, 0.2, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
  /** Bezier control points for libraries that take arrays (e.g. `motion`). */
  easingPoints: {
    standard: [0.2, 0, 0, 1],
    emphasized: [0.3, 0, 0, 1],
    enter: [0, 0, 0.2, 1],
    exit: [0.4, 0, 1, 1],
  },
  /** `motion` spring; `--ease-spring` in motion.css is sampled from it. */
  spring: { type: 'spring', stiffness: 420, damping: 34, mass: 1 },
} as const;

export const zIndex = {
  base: 0,
  sticky: 10,
  dropdown: 20,
  overlay: 30,
  modal: 40,
  popover: 50,
  toast: 60,
  tooltip: 70,
  max: 9999,
} as const;

export type ZIndexToken = keyof typeof zIndex;

export const tokens = { color, motion, zIndex } as const;
