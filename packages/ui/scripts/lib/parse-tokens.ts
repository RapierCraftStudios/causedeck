// Reads the token stylesheets with PostCSS. The contrast checker, the TOKENS.md generator and
// the token tests all use this module, so the CSS stays the single source of truth.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import postcss, { type AtRule, type ChildNode, type Node, type Root, type Rule } from 'postcss';

export const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TOKENS_DIR = path.join(UI_ROOT, 'tokens');

/** Token files in the order `tokens/index.css` imports them (fonts are imported first). */
export const TOKEN_FILES = [
  'primitives.css',
  'semantic.css',
  'typography.css',
  'spacing-radius-shadow.css',
  'motion.css',
  'z-index.css',
  'base.css',
] as const;

export const LIGHT_SELECTOR = ':root';
export const DARK_SELECTORS = ['.dark', '[data-theme=dark]'];
/** The only place an sRGB fallback may appear. */
export const OKLCH_FALLBACK_AT_RULE = 'not (color: oklch(0 0 0))';

export type TokenMap = Map<string, string>;

export function readTokenFile(file: string): Root {
  const from = path.join(TOKENS_DIR, file);
  return postcss.parse(readFileSync(from, 'utf8'), { from });
}

/** Split a selector list on top-level commas (not those inside `:is(...)`), dropping quotes. */
export function splitSelectors(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of selector) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((s) => s.trim().replaceAll('"', '').replaceAll("'", ''));
}

export function isDarkRule(rule: Rule): boolean {
  const selectors = splitSelectors(rule.selector);
  return DARK_SELECTORS.every((s) => selectors.includes(s));
}

/** True when the node sits inside an at-rule (media query, `@supports`, ...). */
export function insideAtRule(node: ChildNode, name?: string, params?: string): boolean {
  let parent: Node | undefined = node.parent;
  while (parent && parent.type !== 'root') {
    if (
      parent.type === 'atrule' &&
      (name === undefined || (parent as AtRule).name === name) &&
      (params === undefined || (parent as AtRule).params === params)
    ) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

/** Top-level custom properties for one theme in one file (rules nested in at-rules are skipped). */
export function customProperties(root: Root, theme: 'light' | 'dark'): TokenMap {
  const map: TokenMap = new Map();
  root.walkRules((rule) => {
    if (insideAtRule(rule)) return;
    const match =
      theme === 'light' ? splitSelectors(rule.selector).includes(LIGHT_SELECTOR) : isDarkRule(rule);
    if (!match) return;
    rule.each((node) => {
      if (node.type === 'decl' && node.prop.startsWith('--')) map.set(node.prop, node.value);
    });
  });
  return map;
}

/** Light and dark custom properties across every token file. Dark inherits light where unset. */
export function loadThemes(files: readonly string[] = TOKEN_FILES): {
  light: TokenMap;
  dark: TokenMap;
} {
  const light: TokenMap = new Map();
  const darkOnly: TokenMap = new Map();
  for (const file of files) {
    const root = readTokenFile(file);
    for (const [k, v] of customProperties(root, 'light')) light.set(k, v);
    for (const [k, v] of customProperties(root, 'dark')) darkOnly.set(k, v);
  }
  return { light, dark: new Map([...light, ...darkOnly]) };
}

/** Resolve `var(--x)` references (no fallbacks needed for tokens) against a theme map. */
export function resolveValue(value: string, map: TokenMap, depth = 0): string {
  if (depth > 10) throw new Error(`var() cycle while resolving ${value}`);
  return value.replaceAll(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const next = map.get(name);
    if (next === undefined) throw new Error(`undefined token ${name}`);
    return resolveValue(next, map, depth + 1);
  });
}

/** Semantic colour roles from the issue #7 specification table, in display order. */
export const SEMANTIC_COLOR_ROLES = [
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
] as const;

export const STAGES = [
  'filed',
  'sr_fr',
  'defects',
  're_presented',
  'numbered',
  'disposed',
  'listed',
  'reserved',
  'part-heard',
] as const;

export const LEVELS = ['l1', 'l2', 'l3', 'l4'] as const;
export const CHART_COUNT = 8;

/** Every colour token name (without `--`) that must exist in both themes. */
export function colorTokenNames(): string[] {
  return [
    ...SEMANTIC_COLOR_ROLES,
    ...STAGES.flatMap((s) => [`stage-${s}`, `stage-${s}-soft`]),
    ...LEVELS.map((l) => `level-${l}`),
    ...Array.from({ length: CHART_COUNT }, (_, i) => `chart-${String(i + 1)}`),
  ];
}
