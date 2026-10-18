import { describe, expect, it } from 'vitest';

interface BudgetModule {
  BUDGET_BYTES: number;
  initialChunks: (
    buildManifest: { rootMainFiles?: string[] },
    clientReferenceManifest: { entryJSFiles?: Record<string, string[]> },
  ) => string[];
  evaluateBudget: (
    sizes: { file: string; gzipBytes: number }[],
    budget?: number,
  ) => { total: number; budget: number; ok: boolean };
  parseClientReferenceManifest: (source: string) => { entryJSFiles?: Record<string, string[]> };
  WORKSPACE_SHELL_BUDGET_BYTES: number;
  WORKSPACE_ROUTE_MANIFEST: string;
  shellDelta: (
    homeChunks: string[],
    routeChunks: string[],
    sizes: Record<string, number>,
    budget?: number,
  ) => { files: string[]; total: number; budget: number; ok: boolean };
  GENERATED_MESSAGES: string;
  foreignValues: (en: unknown, others: unknown[]) => string[];
  localeLeak: (
    chunkSources: Record<string, string>,
    values: string[],
  ) => { file: string; value: string }[];
}

// A runtime URL keeps TypeScript from type-resolving the plain .mjs script.
const scriptUrl = new URL('../scripts/check-bundle-budget.mjs', import.meta.url).href;
const budget = (await import(scriptUrl)) as BudgetModule;

describe('bundle budget (spike §10)', () => {
  it('is 180 KB gzip', () => {
    expect(budget.BUDGET_BYTES).toBe(180 * 1024);
  });

  it('passes at the limit and fails one byte over', () => {
    const at = [{ file: 'a.js', gzipBytes: 180 * 1024 }];
    expect(budget.evaluateBudget(at)).toEqual({ total: 184_320, budget: 184_320, ok: true });
    expect(budget.evaluateBudget([...at, { file: 'b.js', gzipBytes: 1 }]).ok).toBe(false);
  });

  it('counts root chunks and every boundary chunk of the home route once, JS only', () => {
    const chunks = budget.initialChunks(
      { rootMainFiles: ['static/chunks/root.js', 'static/chunks/shared.js'] },
      {
        entryJSFiles: {
          '[project]/apps/web/app/layout': ['static/chunks/shared.js', 'static/chunks/layout.js'],
          '[project]/apps/web/app/page': [
            '/_next/static/chunks/page.js',
            'static/chunks/shared.js',
          ],
          '[project]/apps/web/app/error': ['static/chunks/error.js', 'static/css/app.css'],
        },
      },
    );
    expect(chunks).toEqual([
      'static/chunks/error.js',
      'static/chunks/layout.js',
      'static/chunks/page.js',
      'static/chunks/root.js',
      'static/chunks/shared.js',
    ]);
  });

  it('parses the client reference manifest Next.js writes for /page', () => {
    const source =
      'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n' +
      'globalThis.__RSC_MANIFEST["/page"] = {"entryJSFiles":{"x":["static/chunks/x.js"]}};';
    expect(budget.parseClientReferenceManifest(source).entryJSFiles).toEqual({
      x: ['static/chunks/x.js'],
    });
  });
});

describe('workspace shell budget (#155)', () => {
  it('is 40 KB gzip, measured on /w/[slug]/today', () => {
    expect(budget.WORKSPACE_SHELL_BUDGET_BYTES).toBe(40 * 1024);
    expect(budget.WORKSPACE_ROUTE_MANIFEST).toBe(
      'server/app/(app)/w/[slug]/today/page_client-reference-manifest.js',
    );
  });

  it('counts only the workspace chunks the home route does not load, each once', () => {
    const delta = budget.shellDelta(
      ['static/chunks/root.js', 'static/chunks/layout.js'],
      [
        'static/chunks/root.js',
        'static/chunks/shell.js',
        'static/chunks/page.js',
        'static/chunks/shell.js',
      ],
      {
        'static/chunks/root.js': 90_000,
        'static/chunks/shell.js': 1000,
        'static/chunks/page.js': 24,
      },
    );
    expect(delta).toEqual({
      files: ['static/chunks/page.js', 'static/chunks/shell.js'],
      total: 1024,
      budget: 40 * 1024,
      ok: true,
    });
  });

  it('passes at 40 KB and fails one byte over', () => {
    const at = { 'shell.js': 40 * 1024 };
    expect(budget.shellDelta([], ['shell.js'], at).ok).toBe(true);
    expect(budget.shellDelta([], ['shell.js', 'extra.js'], { ...at, 'extra.js': 1 }).ok).toBe(
      false,
    );
  });
});

describe('active-locale messages only (#174)', () => {
  const en = { a: { title: 'Something went wrong', short: 'Hi', ref: 'Reference: {digest}' } };
  const ta = { a: { title: 'ஏதோ தவறு நடந்தது.', short: 'வணக்கம்', ref: 'குறிப்பு: {digest}' } };

  it('reads the generated catalogs of @causedeck/i18n', () => {
    expect(budget.GENERATED_MESSAGES).toBe('../../packages/i18n/src/generated/messages');
  });

  it('picks distinctive ta/kn strings: 8+ characters, not English, no ICU syntax', () => {
    expect(budget.foreignValues(en, [ta, { b: 'Something went wrong' }])).toEqual([
      'ஏதோ தவறு நடந்தது.',
    ]);
  });

  it('finds a foreign catalog string in a chunk, raw or \\u-escaped', () => {
    const value = 'ஏதோ தவறு நடந்தது.';
    const escaped = value.replace(
      /[^\x20-\x7e]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    expect(
      budget.localeLeak(
        { 'raw.js': `x="${value}"`, 'escaped.js': `x="${escaped}"`, 'clean.js': 'x="en"' },
        [value],
      ),
    ).toEqual([
      { file: 'raw.js', value },
      { file: 'escaped.js', value },
    ]);
  });
});
