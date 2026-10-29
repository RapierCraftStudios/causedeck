// i18n of the matters list (#388): every string is a key in the `matters` namespace (en complete,
// ta and kn with the same keys), dates come from the #24 locale formatter with tabular numerals,
// and ₹ appears nowhere on these screens. The keys the matters code asks for are read from its
// source, so a new `t('...')` without a catalog entry fails here before it renders a raw key.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { catalogs } from './helpers/intl.ts';

const APP = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = ['components/matters', 'app/(app)/w/[slug]/matters', 'lib/matters'];

function files(dir: string): string[] {
  const full = path.join(APP, dir);
  return readdirSync(full).flatMap((entry) => {
    const at = path.join(full, entry);
    if (statSync(at).isDirectory()) return files(path.join(dir, entry));
    return /\.tsx?$/.test(entry) ? [at] : [];
  });
}

const sources = SOURCES.flatMap(files).map((file) => ({
  file: path.relative(APP, file),
  text: readFileSync(file, 'utf8'),
}));

function flatten(value: unknown, prefix = '', into: Record<string, string> = {}) {
  if (typeof value === 'string') into[prefix] = value;
  else
    for (const [key, child] of Object.entries(value as Record<string, unknown>))
      flatten(child, prefix === '' ? key : `${prefix}.${key}`, into);
  return into;
}

const en = flatten(catalogs.en.matters);

/** `namespace.key` for every literal `t('key')` under a `useTranslations`/`getTranslations` call. */
function usedKeys(text: string): string[] {
  const namespaces = [
    ...text.matchAll(/(?:useTranslations|getTranslations)\(\s*'([\w.]+)'\s*\)/g),
  ].map((match) => match[1] as string);
  const keys = [...text.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((match) => match[1] as string);
  if (namespaces.length === 0) return [];
  // A file uses one namespace for its `t` (matters, or a sub-namespace of it).
  return keys.map((key) => `${namespaces[0] as string}.${key}`);
}

describe('matters i18n (#388)', () => {
  it('finds the matters sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(12);
  });

  it.each(['ta', 'kn'] as const)('%s has the same matters keys as en, none empty', (locale) => {
    const other = flatten(catalogs[locale].matters);
    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(other)) expect(value.trim(), key).not.toBe('');
  });

  it('has a complete English catalog with no exclamation marks', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), key).not.toBe('');
      expect(value, key).not.toContain('!');
    }
  });

  it('never uses ₹ in the catalogs or the matters code', () => {
    for (const locale of ['en', 'ta', 'kn'] as const) {
      expect(JSON.stringify(catalogs[locale].matters)).not.toContain('₹');
    }
    for (const { file, text } of sources) expect(text, file).not.toContain('₹');
  });

  it('resolves every key the matters code asks for', () => {
    const missing: string[] = [];
    let checked = 0;
    // Flatten once: every key, plus every parent path (template keys are checked through it).
    const entries = Object.keys(flatten(catalogs.en));
    const keys = new Set(entries);
    for (const entry of entries)
      for (let at = entry.indexOf('.'); at !== -1; at = entry.indexOf('.', at + 1))
        keys.add(entry.slice(0, at));
    for (const { file, text } of sources) {
      for (const key of usedKeys(text)) {
        checked += 1;
        // Template keys (`filters.statusValues.${status}`) are checked through their parent.
        const known = keys.has(key);
        if (!known) missing.push(`${file}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  it('formats dates with the #24 formatter and shows them in tabular numerals', () => {
    const deps = sources.find((entry) => entry.file === 'lib/matters/graph-deps.ts')?.text ?? '';
    expect(deps).toMatch(
      /import \{ formatDate, formatRelativeFrom, type Locale \} from '@causedeck\/i18n'/,
    );
    const card = sources.find((entry) => entry.file === 'components/matters/matter-card.tsx');
    expect(card?.text).toMatch(/font-semibold tabular-nums">\{nextDate\.text\}/);
    expect(
      sources.some((entry) => /toLocaleDateString|new Intl\.DateTimeFormat/.test(entry.text)),
    ).toBe(false);
  });
});
