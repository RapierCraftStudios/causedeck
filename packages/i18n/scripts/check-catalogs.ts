// `pnpm i18n:check [--report]`: keeps the en/ta/kn catalogs in sync (CI gate, #174).
//
// Fails on: a key missing from or extra to ta/kn (against en); an empty or non-string message; an
// ICU syntax error; ICU arguments or rich-text tags that differ from en; a ta/kn string identical to
// en that is not allow-listed; a top-level key defined in two namespace files; an unknown namespace
// file; stale generated files (`pnpm i18n:types`); and a translation-status.json out of sync with
// the keys. `--report` also prints draft/reviewed counts and the glossary terms awaiting review.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';

import { flattenKeys, getPath, NAMESPACES, type Catalog } from '../src/catalog';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../src/locales';

import { generate, mergeLocale, PACKAGE_ROOT, readSources, type Sources } from './gen-types';

export type TranslatedLocale = Exclude<Locale, 'en'>;

const TRANSLATED = LOCALES.filter((locale): locale is TranslatedLocale => locale !== 'en');

export type Status = 'draft' | 'reviewed';

export interface TranslationStatus {
  /** Dotted ids whose ta/kn text may equal English (proper nouns, examples). */
  allowUntranslated?: string[];
  ta?: Record<string, string>;
  kn?: Record<string, string>;
}

export interface GlossaryTerm {
  en: string;
  ta: string;
  kn: string;
  status: 'needs-lawyer-review' | 'reviewed';
  note?: string;
}

export interface Glossary {
  terms: GlossaryTerm[];
}

/** Strings that are the same in every language. */
export const UNTRANSLATED_VALUES: readonly string[] = ['CauseDeck', 'name@example.com'];

export interface CheckInput {
  sources: Sources;
  status: TranslationStatus;
  glossary: Glossary;
  /** Current contents of the generated files (`undefined` when absent). */
  generated: Record<string, string | undefined>;
}

export interface CheckResult {
  errors: string[];
  report: string[];
}

/** Argument names and rich-text tags of an ICU message, sorted and de-duplicated. */
export function placeholders(elements: MessageFormatElement[]): string[] {
  const found = new Set<string>();
  const walk = (nodes: MessageFormatElement[]) => {
    for (const node of nodes) {
      switch (node.type) {
        case TYPE.argument:
        case TYPE.number:
        case TYPE.date:
        case TYPE.time:
          found.add(node.value);
          break;
        case TYPE.select:
        case TYPE.plural:
          found.add(node.value);
          for (const option of Object.values(node.options)) walk(option.value);
          break;
        case TYPE.tag:
          found.add(`<${node.value}>`);
          walk(node.children);
          break;
        default:
          break;
      }
    }
  };
  walk(elements);
  return [...found].sort();
}

function parseMessage(text: string): { ok: true; args: string[] } | { ok: false; error: string } {
  try {
    return { ok: true, args: placeholders(parse(text)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Which namespace file holds each top-level key. */
function fileOf(files: Record<string, Catalog>): Map<string, string> {
  const owner = new Map<string, string>();
  for (const [file, content] of Object.entries(files)) {
    for (const key of Object.keys(content)) owner.set(key, file);
  }
  return owner;
}

/** Text of a message with ICU arguments removed, to tell prose from pure placeholders. */
function hasProse(text: string): boolean {
  return /\p{L}/u.test(text.replace(/\{[^}]*\}/g, ''));
}

export function checkCatalogs({ sources, status, glossary, generated }: CheckInput): CheckResult {
  const errors: string[] = [];
  const report: string[] = [];
  const catalogs = {} as Record<Locale, Catalog>;

  for (const locale of LOCALES) {
    const files = sources[locale];
    for (const file of Object.keys(files)) {
      if (!(NAMESPACES as readonly string[]).includes(file)) {
        errors.push(
          `${locale}/${file}.json: unknown namespace file (expected ${NAMESPACES.join(', ')})`,
        );
      }
    }
    try {
      catalogs[locale] = mergeLocale(files);
    } catch (error) {
      errors.push(`${locale}: ${error instanceof Error ? error.message : String(error)}`);
      catalogs[locale] = {};
    }
  }

  const en = catalogs.en;
  const enKeys = flattenKeys(en);
  const enArgs = new Map<string, string[]>();

  for (const locale of LOCALES) {
    const catalog = catalogs[locale];
    for (const id of flattenKeys(catalog)) {
      const value = getPath(catalog, id);
      if (typeof value !== 'string') {
        errors.push(`${locale}: ${id} is not a string`);
        continue;
      }
      if (value.trim() === '') {
        errors.push(`${locale}: ${id} is empty`);
        continue;
      }
      const parsed = parseMessage(value);
      if (!parsed.ok) {
        errors.push(`${locale}: ${id} has invalid ICU syntax (${parsed.error})`);
        continue;
      }
      if (locale === DEFAULT_LOCALE) enArgs.set(id, parsed.args);
    }
  }

  const allowed = new Set(status.allowUntranslated ?? []);
  for (const locale of TRANSLATED) {
    const catalog = catalogs[locale];
    const keys = new Set(flattenKeys(catalog));
    for (const id of enKeys) {
      if (!keys.has(id)) errors.push(`${locale}: missing key ${id}`);
    }
    for (const id of keys) {
      if (getPath(en, id) === undefined) errors.push(`${locale}: extra key ${id} (not in en)`);
    }
    for (const id of enKeys) {
      const value = getPath(catalog, id);
      const english = getPath(en, id);
      if (typeof value !== 'string' || typeof english !== 'string' || value.trim() === '') continue;
      const expected = enArgs.get(id);
      const parsed = parseMessage(value);
      if (expected && parsed.ok && expected.join(',') !== parsed.args.join(',')) {
        errors.push(
          `${locale}: ${id} placeholders {${parsed.args.join(', ')}} differ from en {${expected.join(', ')}}`,
        );
      }
      if (
        value === english &&
        hasProse(value) &&
        !allowed.has(id) &&
        !UNTRANSLATED_VALUES.includes(value)
      ) {
        errors.push(`${locale}: ${id} is an untranslated copy of en ("${value}")`);
      }
    }

    const states = status[locale] ?? {};
    for (const id of enKeys) {
      if (!(id in states)) errors.push(`translation-status.json: ${locale}.${id} has no status`);
    }
    for (const [id, state] of Object.entries(states)) {
      if (getPath(en, id) === undefined) {
        errors.push(`translation-status.json: ${locale}.${id} is not a key`);
      } else if (state !== 'draft' && state !== 'reviewed') {
        errors.push(`translation-status.json: ${locale}.${id} is "${state}" (draft|reviewed)`);
      }
    }
  }
  for (const id of allowed) {
    if (getPath(en, id) === undefined) {
      errors.push(`translation-status.json: allowUntranslated ${id} is not a key`);
    }
  }

  if (errors.length === 0) {
    for (const [file, content] of Object.entries(generate(sources))) {
      if (generated[file] !== content) {
        errors.push(`${file} is stale: run \`pnpm i18n:types\``);
      }
    }
  }

  // Report: review progress per locale and namespace file, then the glossary.
  const owner = fileOf(sources.en);
  for (const locale of TRANSLATED) {
    const states = status[locale] ?? {};
    const counts = new Map<string, { draft: number; reviewed: number }>();
    for (const id of enKeys) {
      const file = owner.get(id.split('.')[0] ?? '') ?? '?';
      const entry = counts.get(file) ?? { draft: 0, reviewed: 0 };
      if (states[id] === 'reviewed') entry.reviewed += 1;
      else entry.draft += 1;
      counts.set(file, entry);
    }
    const total = [...counts.values()].reduce((sum, entry) => sum + entry.reviewed, 0);
    report.push(`${locale}: ${String(total)}/${String(enKeys.length)} reviewed`);
    for (const [file, entry] of counts) {
      report.push(`  ${file}: ${String(entry.reviewed)} reviewed, ${String(entry.draft)} draft`);
    }
  }
  const pending = glossary.terms.filter((term) => term.status === 'needs-lawyer-review');
  report.push(
    `glossary: ${String(pending.length)}/${String(glossary.terms.length)} terms need lawyer review`,
  );
  for (const term of pending)
    report.push(`  needs-lawyer-review: ${term.en} (ta ${term.ta}, kn ${term.kn})`);
  for (const term of glossary.terms) {
    const word = new RegExp(`\\b${term.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    for (const id of enKeys) {
      const english = getPath(en, id);
      if (typeof english !== 'string' || !word.test(english)) continue;
      for (const locale of TRANSLATED) {
        const value = getPath(catalogs[locale], id);
        if (typeof value === 'string' && !value.includes(term[locale])) {
          report.push(`  glossary: ${locale}.${id} uses "${term.en}" without "${term[locale]}"`);
        }
      }
    }
  }

  return { errors, report };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(PACKAGE_ROOT, file), 'utf8'));
}

function readIfPresent(file: string): string | undefined {
  try {
    return readFileSync(path.join(PACKAGE_ROOT, file), 'utf8');
  } catch {
    return undefined;
  }
}

function main(): void {
  const sources = readSources();
  const generated = Object.fromEntries(
    Object.keys(generate(sources)).map((file) => [file, readIfPresent(file)]),
  );
  const { errors, report } = checkCatalogs({
    sources,
    status: readJson('translation-status.json') as TranslationStatus,
    glossary: readJson('glossary.json') as Glossary,
    generated,
  });
  if (process.argv.includes('--report')) for (const line of report) console.log(line);
  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`);
    console.error(`i18n:check failed with ${String(errors.length)} error(s).`);
    process.exitCode = 1;
    return;
  }
  console.log('i18n:check: en, ta and kn catalogs are in sync.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
