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
        'activity',
        'audit',
        'auth',
        'billing',
        'bootstrapImport',
        'calendar',
        'camera',
        'caseWatch',
        'common',
        'courtDay',
        'courtInsights',
        'courts',
        'courtsRosters',
        'emailIntake',
        'error',
        'help',
        'home',
        'importReview',
        'inbox',
        'invite',
        'lifecycle',
        'locale',
        'matterTimeline',
        'matters',
        'members',
        'nav',
        'notFound',
        'notices',
        'notifications',
        'offline',
        'onboardingDiscovery',
        'palette',
        'portfolio',
        'provisioning',
        'pwa',
        'settings',
        'shell',
        'shortcuts',
        'theme',
        'usage',
        'voice',
        'whatsappImport',
        'whatsappLink',
        'workspace',
      ].sort(),
    );
  });
});

describe('case-watch copy (#593)', () => {
  it('has the case-watch namespace in every locale with the refresh provenance strings', () => {
    expect(en.caseWatch.refresh.label).toBe('Refresh status');
    expect(en.caseWatch.refresh.via.server).toContain('{tier}');
    expect(ta.caseWatch.refresh.via.server).toContain('{tier}');
    expect(kn.caseWatch.refresh.via.server).toContain('{tier}');
  });
});

describe('camera copy (#52)', () => {
  it('keeps the exact recovery sentence reachable and the camera namespace in every locale', () => {
    expect(en.camera.receipt.copy).toBe('Kept as an attachment. Fee tracking arrives later.');
    expect(en.camera.causeList.title).toBe('This looks like a cause list');
    expect(ta.camera.title.length).toBeGreaterThan(0);
    expect(kn.camera.title.length).toBeGreaterThan(0);
  });
});

describe('voice copy (#543)', () => {
  it('keeps the exact offline sentence and the voice namespace in every locale', () => {
    expect(en.voice.saved.offline).toBe(
      "Saved on this device. Will transcribe when you're back online.",
    );
    expect(en.voice.command).toBe('Record a voice note');
    expect(ta.voice.title.length).toBeGreaterThan(0);
    expect(kn.voice.title.length).toBeGreaterThan(0);
  });
});

describe('document pipeline recovery copy (#45, consumed by #48)', () => {
  it('keeps the stable inbox.unreadable.copy key with the exact English sentence in every locale', () => {
    expect(en.inbox.unreadable.copy).toBe(
      "Couldn't read this. Retake, type the key line, or keep as an attachment.",
    );
    expect(ta.inbox.unreadable.copy.length).toBeGreaterThan(0);
    expect(kn.inbox.unreadable.copy.length).toBeGreaterThan(0);
  });
});

describe('import review recovery copy (#551)', () => {
  it.each([
    ['en', en],
    ['ta', ta],
    ['kn', kn],
  ] as const)('%s reuses the standard unreadable-file sentence', (_locale, messages) => {
    expect(messages.importReview.issues.unreadableCopy).toBe(messages.inbox.unreadable.copy);
  });
});

describe('whatsapp link copy (#681)', () => {
  it('has the whatsappLink namespace in every locale with the opt-in and unlink strings', () => {
    for (const catalog of [en, ta, kn]) {
      expect(catalog.whatsappLink.consent).not.toBe('');
      expect(catalog.whatsappLink.unlink).not.toBe('');
      expect(catalog.whatsappLink.linked).toContain('{number}');
    }
  });
});

describe('help copy (#94)', () => {
  it('has the help namespace in every locale with the footer and contact strings', () => {
    for (const catalog of [en, ta, kn]) {
      expect(catalog.help.footer).not.toBe('');
      expect(catalog.help.contact.whatsapp).toContain('{number}');
      expect(catalog.help.contact.email).toContain('{email}');
    }
    expect(en.help.footer).toBe('This is software documentation, not legal advice.');
  });
});
