// Catalog helpers shared by the scripts, the server loader and tests. Pure: no file or framework
// imports. A locale's catalog is the shallow merge of its namespace files; each file holds whole
// top-level keys (`errors.json` holds `error`, `notFound` and `offline`), so `useTranslations('shell')`
// call sites never depend on which file a key lives in.

/** Namespace files under `src/messages/<locale>/`. */
export const NAMESPACES = [
  'common',
  'nav',
  'shell',
  'auth',
  'workspace',
  'members',
  'notifications',
  'settings',
  'lifecycle',
  'audit',
  'activity',
  'courts',
  'courts-rosters',
  'notices',
  'portfolio',
  'case-watch',
  'court-day',
  'court-insights',
  'matters',
  'matter-timeline',
  'calendar',
  'inbox',
  'pwa',
  'whatsapp-import',
  'bootstrap-import',
  'email-intake',
  'import',
  'camera',
  'voice',
  'errors',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** A nested message tree. Leaves are ICU strings (or precompiled forms after the next-intl loader). */
export interface Catalog {
  [key: string]: unknown;
}

export function isPlainObject(value: unknown): value is Catalog {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merge namespace files into one catalog; a top-level key in two files is an error. */
export function mergeNamespaces(files: Readonly<Partial<Record<string, Catalog>>>): Catalog {
  const merged: Catalog = {};
  const owner = new Map<string, string>();
  for (const [file, content] of Object.entries(files)) {
    for (const [key, value] of Object.entries(content ?? {})) {
      const previous = owner.get(key);
      if (previous !== undefined) {
        throw new Error(
          `Top-level key "${key}" is defined in both ${previous}.json and ${file}.json`,
        );
      }
      owner.set(key, file);
      merged[key] = value;
    }
  }
  return merged;
}

/** Dotted ids of every leaf (`auth.signIn.title`). */
export function flattenKeys(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const id = prefix ? `${prefix}.${key}` : key;
    return isPlainObject(value) ? flattenKeys(value, id) : [id];
  });
}

/** The leaf at a dotted id, or `undefined`. */
export function getPath(catalog: Catalog, id: string): unknown {
  let node: unknown = catalog;
  for (const part of id.split('.')) {
    if (!isPlainObject(node)) return undefined;
    node = node[part];
  }
  return node;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === '';
}

/**
 * Fill every leaf missing (or empty) in `locale` with the one from `base` (English). Returns the
 * merged catalog and the ids that were filled, so the caller can report them.
 */
export function deepMergeFallback(
  base: Catalog,
  locale: Catalog,
): { messages: Catalog; missing: string[] } {
  const missing: string[] = [];
  function merge(fallback: Catalog, own: Catalog, prefix: string): Catalog {
    const out: Catalog = { ...own };
    for (const [key, value] of Object.entries(fallback)) {
      const id = prefix ? `${prefix}.${key}` : key;
      const current = own[key];
      if (isPlainObject(value)) {
        out[key] = merge(value, isPlainObject(current) ? current : {}, id);
      } else if (isMissing(current)) {
        out[key] = value;
        missing.push(id);
      }
    }
    return out;
  }
  return { messages: merge(base, locale, ''), missing };
}
