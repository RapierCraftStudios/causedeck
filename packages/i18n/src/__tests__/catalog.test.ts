import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import en from '../generated/messages/en.json';
import kn from '../generated/messages/kn.json';
import ta from '../generated/messages/ta.json';
import { generate, PACKAGE_ROOT, readSources } from '../../scripts/gen-types';
import {
  deepMergeFallback,
  flattenKeys,
  getPath,
  mergeNamespaces,
  NAMESPACES,
  type Catalog,
} from '../catalog';
import { LOCALES } from '../locales';

describe('mergeNamespaces', () => {
  it('shallow-merges namespace files', () => {
    expect(mergeNamespaces({ common: { a: { x: '1' } }, errors: { b: '2' } })).toEqual({
      a: { x: '1' },
      b: '2',
    });
  });

  it('rejects a top-level key defined in two files', () => {
    expect(() => mergeNamespaces({ common: { a: '1' }, nav: { a: '2' } })).toThrow(
      /"a" is defined in both common\.json and nav\.json/,
    );
  });
});

describe('flattenKeys / getPath', () => {
  const catalog: Catalog = { a: { b: 'x', c: { d: 'y' } }, e: 'z' };
  it('lists dotted leaf ids', () => {
    expect(flattenKeys(catalog)).toEqual(['a.b', 'a.c.d', 'e']);
  });
  it('reads a leaf by id', () => {
    expect(getPath(catalog, 'a.c.d')).toBe('y');
    expect(getPath(catalog, 'a.nope')).toBeUndefined();
    expect(getPath(catalog, 'e.deeper')).toBeUndefined();
  });
});

describe('deepMergeFallback', () => {
  it('fills missing and empty leaves from the base and lists them', () => {
    const base = { a: { b: 'B', c: 'C' }, d: 'D', e: ['precompiled'] };
    const own = { a: { b: 'b' }, d: '' };
    const { messages, missing } = deepMergeFallback(base, own);
    expect(messages).toEqual({ a: { b: 'b', c: 'C' }, d: 'D', e: ['precompiled'] });
    expect(missing.sort()).toEqual(['a.c', 'd', 'e']);
  });

  it('reports nothing for a complete catalog', () => {
    expect(deepMergeFallback({ a: 'A' }, { a: 'அ' })).toEqual({
      messages: { a: 'அ' },
      missing: [],
    });
  });
});

describe('namespaced catalogs (#174)', () => {
  it.each(LOCALES)('%s has exactly one file per namespace', (locale) => {
    const files = readdirSync(path.join(PACKAGE_ROOT, 'src/messages', locale))
      .map((file) => path.basename(file, '.json'))
      .sort();
    expect(files).toEqual([...NAMESPACES].sort());
  });

  it.each(['ta', 'kn'] as const)('%s has the same key set as en', (locale) => {
    const catalogs = { ta, kn };
    expect(flattenKeys(catalogs[locale]).sort()).toEqual(flattenKeys(en).sort());
  });

  it('the committed generated files match the sources', () => {
    const generated = generate(readSources());
    expect(JSON.parse(generated['src/generated/messages/en.json'] ?? '')).toEqual(en);
    expect(JSON.parse(generated['src/generated/messages/ta.json'] ?? '')).toEqual(ta);
    expect(JSON.parse(generated['src/generated/messages/kn.json'] ?? '')).toEqual(kn);
  });

  it('keeps the top-level keys app call sites use', () => {
    expect(Object.keys(en).sort()).toEqual(
      [
        'audit',
        'auth',
        'billing',
        'common',
        'error',
        'home',
        'invite',
        'lifecycle',
        'locale',
        'members',
        'nav',
        'notFound',
        'notifications',
        'offline',
        'palette',
        'settings',
        'shell',
        'shortcuts',
        'theme',
        'usage',
        'workspace',
      ].sort(),
    );
  });
});
