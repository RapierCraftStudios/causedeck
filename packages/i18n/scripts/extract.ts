// `pnpm --filter @causedeck/i18n i18n:extract`: list the message keys apps/web uses with a literal
// id that the English catalog lacks (exit 1), plus how many en keys no literal call references (info:
// keys built at runtime, such as `pages.${route}`, are expected there).
//
// Static and deliberately simple: it follows `const t = useTranslations('ns')` /
// `await getTranslations('ns')` bindings within a file and their `t('key')` calls. Dynamic keys and
// translators passed between files are skipped.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenKeys, getPath, isPlainObject, type Catalog } from '../src/catalog';

import { PACKAGE_ROOT, mergeLocale, readSources } from './gen-types';

const BINDING =
  /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;

/** Fully qualified message ids used with a literal key in `source`. */
export function extractKeys(source: string): string[] {
  const keys = new Set<string>();
  // Components in one file often each bind `t` to a different namespace: a call belongs to the
  // closest binding of that name above it.
  const bindings = [...source.matchAll(BINDING)].flatMap((match) =>
    match[1] ? [{ name: match[1], namespace: match[2] ?? match[3] ?? '', at: match.index }] : [],
  );
  for (const name of new Set(bindings.map((binding) => binding.name))) {
    const call = new RegExp(
      `(?<![\\w.$])${name}(?:\\.(?:rich|markup|raw|has))?\\(\\s*(?:'([^']+)'|"([^"]+)")`,
      'g',
    );
    for (const match of source.matchAll(call)) {
      const key = match[1] ?? match[2];
      const binding = bindings.findLast((b) => b.name === name && b.at < match.index);
      if (key && binding) keys.add(binding.namespace ? `${binding.namespace}.${key}` : key);
    }
  }
  return [...keys].sort();
}

const SKIP_DIRS = new Set(['node_modules', '.next', '.next-e2e', '__tests__', 'coverage']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

export interface ExtractResult {
  missing: { id: string; file: string }[];
  unreferenced: string[];
}

/** A used id is present when it is a leaf, or a subtree for `t.raw`/`t.has`-style access. */
function present(catalog: Catalog, id: string): boolean {
  const value = getPath(catalog, id);
  return typeof value === 'string' || isPlainObject(value);
}

export function extractFromSources(files: Record<string, string>, en: Catalog): ExtractResult {
  const missing: ExtractResult['missing'] = [];
  const used = new Set<string>();
  for (const [file, source] of Object.entries(files)) {
    for (const id of extractKeys(source)) {
      used.add(id);
      if (!present(en, id)) missing.push({ id, file });
    }
  }
  const unreferenced = flattenKeys(en).filter((id) => !used.has(id));
  return { missing, unreferenced };
}

function main(): void {
  const appDir = path.join(PACKAGE_ROOT, '../../apps/web');
  const files = Object.fromEntries(
    sourceFiles(appDir).map((file) => [path.relative(appDir, file), readFileSync(file, 'utf8')]),
  );
  const { missing, unreferenced } = extractFromSources(files, mergeLocale(readSources().en));
  console.log(
    `i18n:extract: ${String(Object.keys(files).length)} files, ${String(unreferenced.length)} en keys without a literal call (dynamic or unused).`,
  );
  if (missing.length > 0) {
    for (const { id, file } of missing) console.error(`✗ ${file}: ${id} is not in the en catalog`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
