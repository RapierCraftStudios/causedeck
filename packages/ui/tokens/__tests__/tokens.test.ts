/* eslint-disable unicorn/filename-case -- issue #7 fixes the tests under tokens/__tests__/. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import postcss, { type AtRule, type Root, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

import { TOKENS_MD, render } from '../../scripts/gen-token-docs';
import {
  OKLCH_FALLBACK_AT_RULE,
  TOKENS_DIR,
  TOKEN_FILES,
  UI_ROOT,
  colorTokenNames,
  customProperties,
  insideAtRule,
  isDarkRule,
  loadThemes,
  readTokenFile,
  splitSelectors,
} from '../../scripts/lib/parse-tokens';
import { COLOR_TOKENS, motion, zIndex } from '../tokens';

const read = (...segments: string[]): string => readFileSync(path.join(...segments), 'utf8');
const PRESET = path.resolve(UI_ROOT, '..', 'config', 'tailwind', 'preset.css');
const FONTS_DIR = path.join(UI_ROOT, 'fonts');

function walk(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : walk(full, pattern);
    return pattern.test(name) ? [full] : [];
  });
}

/** Tokens declared in only one of :root and the dark rule. */
function themeGaps(root: Root): string[] {
  const light = customProperties(root, 'light');
  const dark = customProperties(root, 'dark');
  return [
    ...[...light.keys()].filter((k) => !dark.has(k)).map((k) => `${k} (light only)`),
    ...[...dark.keys()].filter((k) => !light.has(k)).map((k) => `${k} (dark only)`),
  ];
}

const HEX = /#[\da-f]{3,8}\b/i;
const RGB = /\brgba?\(/i;

/** Hex or rgb() literals in CSS, ignoring comments and the sanctioned `@supports not` fallback. */
function cssColorLiterals(css: string, from = 'inline.css'): string[] {
  const hits: string[] = [];
  postcss.parse(css, { from }).walkDecls((decl) => {
    if (insideAtRule(decl, 'supports', OKLCH_FALLBACK_AT_RULE)) return;
    if (HEX.test(decl.value) || RGB.test(decl.value)) hits.push(`${from}: ${decl.toString()}`);
  });
  return hits;
}

/** Numeric z-index in CSS or Tailwind classes (`z-10`, `z-[5]`, `zIndex: 3`). */
function numericZIndex(source: string): string[] {
  const patterns = [/z-index\s*:\s*-?\d/g, /\bz-\[?-?\d/g, /zIndex\s*:\s*-?\d/g];
  return patterns.flatMap((p) => [...source.matchAll(p)].map((m) => m[0]));
}

/** Last top-level declaration of `prop` on a rule whose selector list contains `selector`. */
function declared(root: Root, selector: string, prop: string): string | undefined {
  let value: string | undefined;
  root.walkRules((rule) => {
    if (insideAtRule(rule)) return;
    if (!splitSelectors(rule.selector).includes(selector)) return;
    rule.walkDecls(prop, (decl) => {
      value = decl.value;
    });
  });
  return value;
}

function atRules(root: Root, name: string, params: string): AtRule[] {
  const found: AtRule[] = [];
  root.walkAtRules(name, (at) => {
    if (at.params === params) found.push(at);
  });
  return found;
}

function rulesIn(at: AtRule, selector: string): Rule[] {
  const found: Rule[] = [];
  at.walkRules((rule) => {
    if (splitSelectors(rule.selector).includes(selector)) found.push(rule);
  });
  return found;
}

const declsOf = (rules: Rule[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const rule of rules) rule.walkDecls((d) => void map.set(d.prop, d.value));
  return map;
};

const semantic = readTokenFile('semantic.css');
const typography = readTokenFile('typography.css');
const motionCss = readTokenFile('motion.css');
const base = readTokenFile('base.css');
const themes = loadThemes();

describe('semantic colour tokens', () => {
  it('defines every spec token in both light and dark, in OKLCH', () => {
    const light = customProperties(semantic, 'light');
    const dark = customProperties(semantic, 'dark');
    const problems: string[] = [];
    for (const name of colorTokenNames()) {
      for (const [theme, map] of [
        ['light', light],
        ['dark', dark],
      ] as const) {
        const value = map.get(`--${name}`);
        if (value === undefined) problems.push(`--${name} missing in ${theme}`);
        else if (!value.startsWith('oklch(')) problems.push(`--${name} is not OKLCH in ${theme}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('has no token that exists in only one theme', () => {
    expect(themeGaps(semantic)).toEqual([]);
  });

  it('detects a token defined in only one theme', () => {
    const broken = postcss.parse(
      ':root { --a: oklch(1 0 0); --b: oklch(0 0 0); } .dark, [data-theme=dark] { --a: oklch(0 0 0); }',
    );
    expect(themeGaps(broken)).toEqual(['--b (light only)']);
  });
});

describe('colour literals', () => {
  const cssFiles = [
    ...TOKEN_FILES.map((f) => path.join(TOKENS_DIR, f)),
    path.join(TOKENS_DIR, 'index.css'),
    path.join(FONTS_DIR, 'fonts.css'),
    PRESET,
    ...walk(path.join(UI_ROOT, 'src'), /\.css$/),
  ];
  const codeFiles = walk(path.join(UI_ROOT, 'src'), /\.(ts|tsx)$/);

  it('has no hex or rgb() literal in token, font, preset or component CSS', () => {
    expect(cssFiles.flatMap((f) => cssColorLiterals(read(f), path.basename(f)))).toEqual([]);
  });

  it('has no hex or rgb() literal in component code', () => {
    const hits = codeFiles.filter((f) => {
      const source = read(f);
      return HEX.test(source.replaceAll(/\/\/.*$/gm, '')) || RGB.test(source);
    });
    expect(hits).toEqual([]);
  });

  it('allows an sRGB fallback only inside @supports not (color: oklch(0 0 0))', () => {
    const css = `@supports not (color: oklch(0 0 0)) { :root { --surface: #fbfaf7; } }
      :root { --ink: rgb(1 2 3); --line: #ddd; }`;
    expect(cssColorLiterals(css)).toEqual([
      'inline.css: --ink: rgb(1 2 3)',
      'inline.css: --line: #ddd',
    ]);
  });

  it('keeps backgrounds flat: no gradients, grain or textures', () => {
    const hits = cssFiles.filter((f) =>
      /gradient\(|url\([^)]*\.(png|jpe?g|svg|webp)/i.test(read(f)),
    );
    expect(hits).toEqual([]);
  });
});

describe('TypeScript mirror', () => {
  it('lists exactly the colour tokens defined in the CSS', () => {
    expect([...COLOR_TOKENS]).toEqual(colorTokenNames());
    const cssColors = [...customProperties(semantic, 'light').keys()].map((k) => k.slice(2));
    expect([...COLOR_TOKENS].sort()).toEqual(cssColors.sort());
  });

  it('matches motion durations and easings', () => {
    for (const [name, ms] of Object.entries(motion.duration)) {
      expect(themes.light.get(`--dur-${name}`)).toBe(`${String(ms)}ms`);
    }
    for (const [name, value] of Object.entries(motion.easing)) {
      expect(themes.light.get(`--ease-${name}`)).toBe(value);
      const points = motion.easingPoints[name as keyof typeof motion.easingPoints];
      expect(value).toBe(`cubic-bezier(${points.join(', ')})`);
    }
    expect(motion.spring).toMatchObject({ stiffness: 420, damping: 34 });
  });

  it('matches the z-index scale', () => {
    const css = Object.fromEntries(
      [...themes.light]
        .filter(([k]) => k.startsWith('--z-'))
        .map(([k, v]) => [k.slice(4), Number(v)]),
    );
    expect(css).toEqual(zIndex);
  });
});

describe('dark mode', () => {
  it('is switched by class `dark` (and [data-theme=dark]) with color-scheme in both themes', () => {
    let darkRule: Rule | undefined;
    semantic.walkRules((rule) => {
      if (isDarkRule(rule)) darkRule = rule;
    });
    expect(darkRule).toBeDefined();
    expect(declared(semantic, ':root', 'color-scheme')).toBe('light');
    expect(declared(semantic, '.dark', 'color-scheme')).toBe('dark');
  });

  it('uses the same class in the Tailwind variant', () => {
    expect(read(PRESET)).toContain('@custom-variant dark (&:where(.dark, .dark *));');
  });

  it('expresses dark elevation with the 1px top-edge highlight', () => {
    expect(themes.dark.get('--shadow-highlight')).toBe('inset 0 1px 0 oklch(1 0 0 / 0.04)');
    for (const n of [1, 2, 3, 4]) {
      expect(themes.dark.get(`--shadow-${String(n)}`)).toContain('var(--shadow-highlight)');
    }
  });
});

describe('motion', () => {
  const DURATIONS = { instant: '80ms', fast: '150ms', base: '200ms', slow: '250ms', page: '320ms' };

  it('defines the duration and easing tokens', () => {
    for (const [name, value] of Object.entries(DURATIONS)) {
      expect(themes.light.get(`--dur-${name}`)).toBe(value);
    }
    expect(themes.light.get('--ease-standard')).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(themes.light.get('--ease-emphasized')).toBe('cubic-bezier(0.3, 0, 0, 1)');
    expect(themes.light.get('--ease-enter')).toBe('cubic-bezier(0, 0, 0.2, 1)');
    expect(themes.light.get('--ease-exit')).toBe('cubic-bezier(0.4, 0, 1, 1)');
    expect(themes.light.get('--ease-spring')).toMatch(/^linear\(/);
  });

  it('resolves every duration to 0.01ms and disables transforms under reduced motion', () => {
    const [reduce] = atRules(motionCss, 'media', '(prefers-reduced-motion: reduce)');
    expect(reduce).toBeDefined();
    if (!reduce) return;
    const root = declsOf(rulesIn(reduce, ':root'));
    for (const name of Object.keys(DURATIONS)) expect(root.get(`--dur-${name}`)).toBe('0.01ms');
    expect(root.get('--motion-transform')).toBe('none');
    const all = declsOf(rulesIn(reduce, '*'));
    expect(all.get('animation-duration')).toBe('0.01ms');
    expect(all.get('transition-duration')).toBe('0.01ms');
    expect(declsOf(rulesIn(reduce, '[data-motion]')).get('transform')).toBe('none');
  });
});

describe('z-index', () => {
  it('uses the semantic scale', () => {
    expect(zIndex).toEqual({
      base: 0,
      sticky: 10,
      dropdown: 20,
      overlay: 30,
      modal: 40,
      popover: 50,
      toast: 60,
      tooltip: 70,
      max: 9999,
    });
  });

  it('is never hard-coded as a number outside z-index.css', () => {
    const files = [
      ...walk(path.join(UI_ROOT, 'src'), /\.(ts|tsx|css)$/),
      ...TOKEN_FILES.filter((f) => f !== 'z-index.css').map((f) => path.join(TOKENS_DIR, f)),
      path.join(TOKENS_DIR, 'reference.html'),
      PRESET,
    ];
    const hits = files.flatMap((f) =>
      numericZIndex(read(f)).map((h) => `${path.basename(f)}: ${h}`),
    );
    expect(hits).toEqual([]);
  });

  it('detects numeric z-index in CSS and class names', () => {
    expect(numericZIndex('.a { z-index: 5 } <div class="z-10 z-[3]">')).toEqual([
      'z-index: 5',
      'z-1',
      'z-[3',
    ]);
    expect(numericZIndex('.a { z-index: var(--z-modal) } <div class="z-modal">')).toEqual([]);
  });
});

describe('numerals', () => {
  it.each(['.num', 'table', 'time', '[data-inr]', '.inr'])('%s gets tabular numerals', (sel) => {
    expect(declared(base, sel, 'font-variant-numeric')).toBe('tabular-nums');
  });

  it.each(['.id', '[data-mono-id]'])('%s mono IDs get tabular-nums slashed-zero', (sel) => {
    expect(declared(base, sel, 'font-variant-numeric')).toBe('tabular-nums slashed-zero');
    expect(declared(base, sel, 'font-family')).toBe('var(--font-mono)');
  });
});

describe('focus, selection and scrollbars', () => {
  it('draws a 2px ring in --ring with a 2px offset on :focus-visible', () => {
    expect(declared(base, ':focus-visible', 'outline')).toBe('2px solid var(--ring)');
    expect(declared(base, ':focus-visible', 'outline-offset')).toBe('2px');
    expect(declared(base, ':focus:not(:focus-visible)', 'outline')).toBe('none');
  });

  it('never removes the focus-visible ring anywhere', () => {
    const removals: string[] = [];
    for (const file of [...TOKEN_FILES.map((f) => path.join(TOKENS_DIR, f)), PRESET]) {
      postcss.parse(read(file)).walkDecls(/^outline(-style|-width)?$/, (decl) => {
        const rule = decl.parent as Rule | undefined;
        const selector = rule?.selector ?? '';
        const removes = /^(none|0)$/.test(decl.value);
        if (
          removes &&
          selector.includes(':focus-visible') &&
          !selector.includes(':not(:focus-visible)')
        ) {
          removals.push(`${path.basename(file)}: ${selector}`);
        }
      });
    }
    expect(removals).toEqual([]);
  });

  it('maps the ring to Highlight in forced-colors mode', () => {
    const [forced] = atRules(base, 'media', '(forced-colors: active)');
    expect(forced && declsOf(rulesIn(forced, ':root')).get('--ring')).toBe('Highlight');
  });

  it('uses accent-soft selection with ink, and thin line-strong scrollbars', () => {
    expect(declared(base, '::selection', 'background-color')).toBe('var(--accent-soft)');
    expect(declared(base, '::selection', 'color')).toBe('var(--ink)');
    expect(declared(base, 'html', 'scrollbar-color')).toBe('var(--line-strong) transparent');
    expect(declared(base, 'html', 'scrollbar-width')).toBe('thin');
  });

  it('defines a 44px hit target token', () => {
    expect(themes.light.get('--hit')).toBe('44px');
  });
});

describe('print', () => {
  it('defines --print-margin 18mm and an A4 page', () => {
    expect(themes.light.get('--print-margin')).toBe('18mm');
    let page: AtRule | undefined;
    base.walkAtRules('page', (at) => void (page = at));
    const decls = new Map<string, string>();
    page?.walkDecls((d) => void decls.set(d.prop, d.value));
    expect(decls.get('size')).toBe('A4');
    expect(decls.get('margin')).toBe(themes.light.get('--print-margin'));
  });

  it('prints ink on white in both themes', () => {
    const [print] = atRules(base, 'media', 'print');
    expect(print).toBeDefined();
    if (!print) return;
    const rules = rulesIn(print, ':root');
    expect(rules.some((r) => splitSelectors(r.selector).includes('.dark'))).toBe(true);
    const decls = declsOf(rules);
    expect(decls.get('--print-paper')).toBe('oklch(1 0 0)');
    expect(decls.get('--print-ink')).toBe('oklch(0 0 0)');
    expect(decls.get('--surface')).toBe('var(--print-paper)');
    expect(decls.get('--ink')).toBe('var(--print-ink)');
    expect(decls.get('--shadow-2')).toBe('none');
  });
});

describe('typography', () => {
  /** Families in a stack, without quotes. */
  const families = (stack: string | undefined): string[] =>
    (stack ?? '').split(',').map((f) => f.trim().replaceAll(/['"]/g, ''));
  const inOrder = (actual: string[], expected: string[]): boolean => {
    let i = 0;
    for (const family of actual) if (family === expected[i]) i++;
    return i === expected.length;
  };

  it('uses the specified font stacks (metric fallbacks may be interleaved)', () => {
    const sans = families(themes.light.get('--font-sans'));
    const serif = families(themes.light.get('--font-serif'));
    expect(sans[0]).toBe('Geist');
    expect(serif[0]).toBe('Newsreader');
    expect(
      inOrder(sans, [
        'Geist',
        'Noto Sans Tamil',
        'Noto Sans Kannada',
        'ui-sans-serif',
        'system-ui',
        'sans-serif',
      ]),
    ).toBe(true);
    expect(
      inOrder(serif, ['Newsreader', 'Noto Serif Tamil', 'Noto Serif Kannada', 'Georgia', 'serif']),
    ).toBe(true);
    expect(families(themes.light.get('--font-mono'))[0]).toBe('Geist Mono');
  });

  const px = (value: string): number => {
    const rems = [...value.matchAll(/([\d.]+)rem/g)].map((m) => Number(m[1]) * 16);
    return Math.max(...rems);
  };

  it.each([
    ['xs', 12, 16],
    ['sm', 13, 20],
    ['base', 14, 22],
    ['md', 16, 26],
    ['lg', 18, 28],
    ['xl', 22, 30],
    ['2xl', 28, 34],
    ['3xl', 36, 42],
  ])('--text-%s reaches %ipx / %ipx in rem', (step, size, line) => {
    const value = themes.light.get(`--text-${step}`) ?? '';
    expect(value).toMatch(/rem/);
    expect(px(value)).toBeCloseTo(size, 2);
    expect(px(themes.light.get(`--text-${step}--line-height`) ?? '')).toBeCloseTo(line, 2);
  });

  it('sets display to 56px / 60px with -0.02em tracking', () => {
    expect(px(themes.light.get('--text-display') ?? '')).toBeCloseTo(56, 2);
    expect(Number(themes.light.get('--text-display--line-height')) * 56).toBeCloseTo(60, 0);
    expect(themes.light.get('--text-display--letter-spacing')).toBe('-0.02em');
  });

  it('styles headings, labels and eyebrows as specified', () => {
    expect(declared(typography, 'h1', 'font-family')).toBe('var(--font-serif)');
    expect(declared(typography, 'h1', 'font-weight')).toBe('var(--weight-medium)');
    expect(declared(typography, 'h1', 'font-optical-sizing')).toBe('auto');
    expect(themes.light.get('--tracking-label')).toBe('-0.005em');
    expect(declared(typography, '.eyebrow', 'text-transform')).toBe('uppercase');
    expect(declared(typography, '.eyebrow', 'color')).toBe('var(--ink-subtle)');
    expect(themes.light.get('--text-eyebrow')).toBe('0.6875rem');
    expect(themes.light.get('--tracking-eyebrow')).toBe('0.06em');
    expect(themes.light.get('--measure-prose')).toBe('68ch');
  });

  /** Evaluate `calc(a + var(--x))` sums against a variable map. */
  const evaluate = (value: string, vars: Map<string, string>): number => {
    const resolved = value.replaceAll(/var\((--[\w-]+)\)/g, (_, n: string) => vars.get(n) ?? 'NaN');
    const terms = resolved.replace(/^calc\((.*)\)$/, '$1').split('+');
    return terms.reduce((sum, t) => sum + Number(t.trim()), 0);
  };

  it('gives Tamil and Kannada body text line-height >= 1.7, no tracking or uppercase', () => {
    for (const lang of [':lang(ta)', ':lang(kn)']) {
      const vars = new Map(themes.light);
      typography.walkRules((rule) => {
        if (splitSelectors(rule.selector).includes(lang)) {
          rule.walkDecls(/^--/, (d) => void vars.set(d.prop, d.value));
        }
      });
      const body = evaluate(vars.get('--leading-body') ?? '', vars);
      const prose = evaluate(vars.get('--leading-prose') ?? '', vars);
      expect(body).toBeGreaterThanOrEqual(1.7);
      expect(prose).toBeGreaterThanOrEqual(1.7);
      expect(body - evaluate(themes.light.get('--leading-body') ?? '', themes.light)).toBeCloseTo(
        0.15,
        5,
      );
      expect(declared(typography, lang, 'letter-spacing')).toBe('var(--tracking-normal)');
      expect(declared(typography, lang, 'text-transform')).toBe('none');
      expect(declared(typography, `p${lang}`, 'line-height')).toBe('var(--leading-body)');
    }
    expect(themes.light.get('--tracking-normal')).toBe('0em');
  });

  it('limits Indic headings and emphasis to weight 500', () => {
    let found = false;
    typography.walkRules((rule) => {
      if (rule.selector.includes(':lang(ta) :is(h1')) {
        found = true;
        const decls = declsOf([rule]);
        expect(decls.get('font-weight')).toBe('var(--weight-medium)');
        expect(decls.get('text-transform')).toBe('none');
      }
    });
    expect(found).toBe(true);
  });
});

describe('spacing and radius', () => {
  it('uses a 4px grid', () => {
    const expected: Record<string, string> = {
      '1': '4px',
      '2': '8px',
      '4': '16px',
      '5': '20px',
      '6': '24px',
      '8': '32px',
      '10': '40px',
      '12': '48px',
      '16': '64px',
      '20': '80px',
      '24': '96px',
    };
    for (const [step, value] of Object.entries(expected)) {
      expect(themes.light.get(`--space-${step}`)).toBe(value);
    }
  });

  it('defines the radius scale', () => {
    expect(
      ['xs', 'sm', 'md', 'lg', 'xl', 'full'].map((r) => themes.light.get(`--radius-${r}`)),
    ).toEqual(['4px', '6px', '8px', '12px', '16px', '9999px']);
  });

  it('defines four elevation steps in both themes', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(themes.light.get(`--shadow-${String(n)}`)).toBeTruthy();
      expect(themes.dark.get(`--shadow-${String(n)}`)).not.toBe(
        themes.light.get(`--shadow-${String(n)}`),
      );
    }
  });
});

describe('fonts', () => {
  const fontsCss = postcss.parse(read(FONTS_DIR, 'fonts.css'));
  const faces: Map<string, string>[] = [];
  fontsCss.walkAtRules('font-face', (at) => {
    const decls = new Map<string, string>();
    at.walkDecls((d) => void decls.set(d.prop, d.value));
    faces.push(decls);
  });
  const family = (f: Map<string, string>): string =>
    (f.get('font-family') ?? '').replaceAll(/['"]/g, '');
  const files = (f: Map<string, string>): string[] =>
    [...(f.get('src') ?? '').matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1] ?? '');

  it('self-hosts every face: relative URLs only, files present', () => {
    const urls = faces.flatMap(files);
    expect(urls.length).toBeGreaterThanOrEqual(6);
    for (const url of urls) {
      expect(url).toMatch(/^\.\/[\w.-]+\.woff2$/);
      expect(statSync(path.join(FONTS_DIR, url)).isFile()).toBe(true);
    }
    expect(read(FONTS_DIR, 'fonts.css')).not.toMatch(/https?:|\/\/fonts\./);
  });

  it('keeps the critical Latin payload (Geist + Newsreader roman) <= 120 KB', () => {
    const critical = faces.filter(
      (f) => ['Geist', 'Newsreader'].includes(family(f)) && f.get('font-style') === 'normal',
    );
    expect(critical).toHaveLength(2);
    const bytes = critical
      .flatMap(files)
      .reduce((sum, url) => sum + statSync(path.join(FONTS_DIR, url)).size, 0);
    expect(bytes).toBeLessThanOrEqual(120_000);
  });

  it('loads Indic fonts only for Tamil or Kannada code points', () => {
    for (const [name, block] of [
      ['Noto Sans Tamil', /U\+0B[89A-F]/],
      ['Noto Sans Kannada', /U\+0C[89A-F]/],
    ] as const) {
      const face = faces.find((f) => family(f) === name);
      const range = face?.get('unicode-range') ?? '';
      expect(range).toMatch(block);
      // No Latin, digits or the rupee sign: those must never trigger an Indic download.
      expect(range).not.toMatch(/U\+00|U\+20B9|U\+20A0-20/);
    }
  });

  it('uses font-display swap, variable weights and metric-matched fallbacks', () => {
    const web = faces.filter((f) => f.has('font-display'));
    expect(web.every((f) => f.get('font-display') === 'swap')).toBe(true);
    expect(web.find((f) => family(f) === 'Geist')?.get('font-weight')).toBe('400 600');
    expect(faces.some((f) => family(f) === 'Newsreader' && f.get('font-style') === 'italic')).toBe(
      true,
    );
    for (const name of ['Geist Fallback', 'Newsreader Fallback', 'Geist Mono Fallback']) {
      const fallback = faces.find((f) => family(f) === name);
      expect(fallback?.get('size-adjust')).toMatch(/%$/);
      expect(fallback?.get('ascent-override')).toMatch(/%$/);
    }
  });

  it('documents every font file under the OFL', () => {
    const licences = read(FONTS_DIR, 'LICENSES.md');
    expect(licences).toContain('SIL Open Font License, Version 1.1');
    for (const file of readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2'))) {
      expect(licences).toContain(file);
    }
  });

  it('is imported first by the token entry stylesheet', () => {
    const imports: string[] = [];
    readTokenFile('index.css').walkAtRules('import', (at) => {
      imports.push(at.params.replaceAll(/['"]/g, ''));
    });
    expect(imports).toEqual(['../fonts/fonts.css', ...TOKEN_FILES.map((f) => `./${f}`)]);
  });
});

describe('reference.html', () => {
  const html = read(TOKENS_DIR, 'reference.html');
  const visible = html
    .replace(/^<!doctype html>/i, '')
    .replaceAll(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');

  it('renders English, Tamil and Kannada specimens with lang attributes', () => {
    expect(html).toMatch(/<article[^>]*lang="en"/);
    expect(html).toMatch(/<article[^>]*lang="ta"[\s\S]*தமிழ்[\s\S]*<\/article>/);
    expect(html).toMatch(/<article[^>]*lang="kn"[\s\S]*ಕನ್ನಡ[\s\S]*<\/article>/);
  });

  it('uses the token stylesheet and a class-based theme toggle', () => {
    expect(html).toContain('<link rel="stylesheet" href="./index.css" />');
    expect(html).toContain("root.classList.toggle('dark')");
  });

  it('shows every colour token', () => {
    const missing = colorTokenNames().filter((n) => !html.includes(`var(--${n})`));
    expect(missing).toEqual([]);
  });

  it('labels every status and stage pill with text, not colour alone', () => {
    // Each pill runs from its opening tag to the next pill or the end of its row.
    const pills = visible
      .split(/class="pill"/)
      .slice(1)
      .map((chunk) => chunk.split(/class="pill"|<\/div>/)[0] ?? '');
    expect(pills.length).toBeGreaterThan(10);
    for (const pill of pills) {
      const text = pill
        .replace(/^[^>]*>/, '')
        .replaceAll(/<[^>]*>/g, '')
        .trim();
      expect(text, pill).toMatch(/\p{L}{2,}/u);
    }
  });

  it('keeps the copy calm: no exclamation marks', () => {
    expect(visible).not.toContain('!');
  });
});

describe('TOKENS.md', () => {
  it('is up to date with the CSS', async () => {
    expect(read(TOKENS_MD)).toBe(await render());
  });
});

describe('package boundaries', () => {
  const pkg = JSON.parse(read(UI_ROOT, 'package.json')) as Record<
    string,
    Record<string, string> | undefined
  >;

  it('depends on no workspace package other than config and validators', () => {
    const deps = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    });
    const internal = deps.filter((d) => d.startsWith('@causedeck/'));
    expect(
      internal.filter((d) => !['@causedeck/config', '@causedeck/validators'].includes(d)),
    ).toEqual([]);
  });

  it('imports no domain package or app from source, tokens or scripts', () => {
    const files = [
      ...walk(path.join(UI_ROOT, 'src'), /\.(ts|tsx)$/),
      ...walk(TOKENS_DIR, /\.(ts|css|html)$/),
      ...walk(path.join(UI_ROOT, 'scripts'), /\.ts$/),
    ];
    const hits = files.filter((f) =>
      /from '@causedeck\/(?!config|validators|ui)|@import '@causedeck\/(?!config|ui)/.test(read(f)),
    );
    expect(hits).toEqual([]);
  });
});

// `isDarkRule`/`splitSelectors` treat quoted and unquoted attribute selectors alike.
describe('selector helpers', () => {
  it('recognises the dark selector list', () => {
    const rule = postcss.parse(".dark, [data-theme='dark'] { --a: 1 }").first as Rule;
    expect(isDarkRule(rule)).toBe(true);
  });

  it('splits only top-level commas', () => {
    expect(splitSelectors(':lang(ta) :is(h1, .eyebrow), .a')).toEqual([
      ':lang(ta) :is(h1, .eyebrow)',
      '.a',
    ]);
  });
});
