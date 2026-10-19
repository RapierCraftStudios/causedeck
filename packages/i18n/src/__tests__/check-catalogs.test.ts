import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkCatalogs,
  placeholders,
  type CheckInput,
  type Glossary,
  type TranslationStatus,
} from '../../scripts/check-catalogs';
import { generate, PACKAGE_ROOT, readSources, type Sources } from '../../scripts/gen-types';
import { parse } from '@formatjs/icu-messageformat-parser';

const read = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(PACKAGE_ROOT, file), 'utf8'));

/** The real repository state, as `pnpm i18n:check` reads it. */
function repoInput(): CheckInput {
  const sources = readSources();
  return {
    sources,
    status: read('translation-status.json') as TranslationStatus,
    glossary: read('glossary.json') as Glossary,
    generated: Object.fromEntries(
      Object.keys(generate(sources)).map((file) => [
        file,
        readFileSync(path.join(PACKAGE_ROOT, file), 'utf8'),
      ]),
    ),
  };
}

/** A small, valid fixture: one namespace, en/ta/kn in sync. */
function fixture(): CheckInput {
  const sources: Sources = {
    en: {
      common: {
        greet: { hello: 'Hello {name}', count: '{n, plural, one {# day} other {# days}}' },
        brand: { name: 'CauseDeck' },
      },
    },
    ta: {
      common: {
        greet: { hello: 'வணக்கம் {name}', count: '{n, plural, one {# நாள்} other {# நாட்கள்}}' },
        brand: { name: 'CauseDeck' },
      },
    },
    kn: {
      common: {
        greet: { hello: 'ನಮಸ್ಕಾರ {name}', count: '{n, plural, one {# ದಿನ} other {# ದಿನಗಳು}}' },
        brand: { name: 'CauseDeck' },
      },
    },
  };
  const keys = ['greet.hello', 'greet.count', 'brand.name'];
  const draft = Object.fromEntries(keys.map((key) => [key, 'draft']));
  return {
    sources,
    status: { ta: { ...draft }, kn: { ...draft } },
    glossary: { terms: [] },
    generated: generate(sources),
  };
}

function errorsOf(mutate: (input: CheckInput) => void): string[] {
  const input = fixture();
  mutate(input);
  return checkCatalogs(input).errors;
}

const common = (input: CheckInput, locale: 'en' | 'ta' | 'kn') =>
  input.sources[locale].common as { greet: Record<string, string>; [key: string]: unknown };

describe('pnpm i18n:check on the repository', () => {
  it('passes', () => {
    expect(checkCatalogs(repoInput()).errors).toEqual([]);
  });

  it('reports draft counts and glossary terms awaiting lawyer review', () => {
    const { report } = checkCatalogs(repoInput());
    expect(report).toContainEqual(expect.stringMatching(/^ta: \d+\/\d+ reviewed$/));
    expect(report).toContainEqual(expect.stringMatching(/^kn: \d+\/\d+ reviewed$/));
    expect(report).toContainEqual(expect.stringMatching(/needs-lawyer-review: Cause list/));
  });

  it('glossary marks court terms needs-lawyer-review', () => {
    const glossary = read('glossary.json') as Glossary;
    for (const term of ['Next date', 'Listed', 'Order', 'Cause list', 'Bench', 'Hall']) {
      expect(glossary.terms.find((entry) => entry.en === term)?.status, term).toBe(
        'needs-lawyer-review',
      );
    }
  });
});

describe('checkCatalogs', () => {
  it('passes a consistent fixture', () => {
    expect(checkCatalogs(fixture()).errors).toEqual([]);
  });

  it('fails on a missing key', () => {
    expect(errorsOf((input) => delete common(input, 'ta').greet.hello)).toContain(
      'ta: missing key greet.hello',
    );
  });

  it('fails on an extra key', () => {
    expect(errorsOf((input) => (common(input, 'kn').greet.extra = 'ಹೆಚ್ಚು'))).toContain(
      'kn: extra key greet.extra (not in en)',
    );
  });

  it('fails on an empty string', () => {
    expect(errorsOf((input) => (common(input, 'ta').greet.hello = ''))).toContain(
      'ta: greet.hello is empty',
    );
  });

  it('fails on a placeholder mismatch', () => {
    const errors = errorsOf((input) => (common(input, 'kn').greet.hello = 'ನಮಸ್ಕಾರ {nmae}'));
    expect(errors).toContainEqual(
      expect.stringMatching(/^kn: greet\.hello placeholders \{nmae\} differ from en \{name\}/),
    );
  });

  it('fails on a plural argument mismatch', () => {
    const errors = errorsOf(
      (input) =>
        (common(input, 'ta').greet.count = '{days, plural, one {# நாள்} other {# நாட்கள்}}'),
    );
    expect(errors).toContainEqual(expect.stringMatching(/^ta: greet\.count placeholders/));
  });

  it('fails on invalid ICU syntax', () => {
    const errors = errorsOf((input) => (common(input, 'ta').greet.hello = 'வணக்கம் {name'));
    expect(errors).toContainEqual(
      expect.stringMatching(/^ta: greet\.hello has invalid ICU syntax/),
    );
  });

  it('fails on an untranslated copy of English, but allows listed values and keys', () => {
    expect(errorsOf((input) => (common(input, 'ta').greet.hello = 'Hello {name}'))).toContain(
      'ta: greet.hello is an untranslated copy of en ("Hello {name}")',
    );
    expect(
      errorsOf((input) => {
        common(input, 'ta').greet.hello = 'Hello {name}';
        input.status.allowUntranslated = ['greet.hello'];
        input.generated = generate(input.sources);
      }),
    ).toEqual([]);
  });

  it('fails on a top-level key in two namespace files', () => {
    const errors = errorsOf((input) => {
      input.sources.en.nav = { brand: { name: 'Dup' } };
    });
    expect(errors).toContainEqual(
      expect.stringMatching(/"brand" is defined in both common\.json and nav\.json/),
    );
  });

  it('fails on an unknown namespace file', () => {
    expect(errorsOf((input) => (input.sources.kn.misc = {}))).toContainEqual(
      expect.stringMatching(/kn\/misc\.json: unknown namespace file/),
    );
  });

  it('fails when generated files are stale', () => {
    expect(
      errorsOf((input) => (input.generated['src/generated/messages/ta.json'] = '{}\n')),
    ).toContain('src/generated/messages/ta.json is stale: run `pnpm i18n:types`');
  });

  it('fails when translation-status.json is out of sync', () => {
    const errors = errorsOf((input) => {
      const ta = input.status.ta as Record<string, string>;
      delete ta['greet.hello'];
      ta['gone.key'] = 'draft';
      (input.status.kn as Record<string, string>)['greet.count'] = 'final';
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        'translation-status.json: ta.greet.hello has no status',
        'translation-status.json: ta.gone.key is not a key',
        'translation-status.json: kn.greet.count is "final" (draft|reviewed)',
      ]),
    );
  });
});

describe('placeholders', () => {
  it('collects arguments, nested plural/select arguments and rich-text tags', () => {
    expect(
      placeholders(
        parse('{a} {n, plural, one {<b>{x}</b>} other {{y, number}}} {s, select, m {z} other {}}'),
      ),
    ).toEqual(['<b>', 'a', 'n', 's', 'x', 'y']);
  });
});
