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
  SW_BUDGET_BYTES: number;
  swBudget: (source: string, budget?: number) => { gzipBytes: number; budget: number; ok: boolean };
  WORKSPACE_ROUTE_MANIFEST: string;
  commonChunks: (...lists: string[][]) => string[];
  shellDelta: (
    homeChunks: string[],
    routeChunks: string[],
    sizes: Record<string, number>,
    budget?: number,
  ) => { files: string[]; total: number; budget: number; ok: boolean };
  ROUTE_CHUNK_BUDGET_BYTES: number;
  COURTS_ROUTE_MANIFESTS: string[];
  MATTERS_ROUTE_BUDGET_BYTES: number;
  MATTERS_ROUTE_MANIFEST: string;
  DRAFTS_ROUTE_BUDGET_BYTES: number;
  DRAFTS_ROUTE_MANIFEST: string;
  INSIGHTS_ROUTE_BUDGET_BYTES: number;
  INSIGHTS_ROUTE_MANIFEST: string;
  TIMELINE_ROUTE_BUDGET_BYTES: number;
  TIMELINE_ROUTE_MANIFEST: string;
  MATTER_WORKSPACE_MANIFEST: string;
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
  it('is 42 KB gzip, measured on /w/[slug]/today', () => {
    expect(budget.WORKSPACE_SHELL_BUDGET_BYTES).toBe(42 * 1024);
    expect(budget.WORKSPACE_ROUTE_MANIFEST).toBe(
      'server/app/(app)/w/[slug]/today/page_client-reference-manifest.js',
    );
  });

  it('defines the shell as the chunks every workspace route loads (#59: /today is a real route now)', () => {
    expect(
      budget.commonChunks(
        ['static/chunks/shell.js', 'static/chunks/board.js', 'static/chunks/b.js'],
        ['static/chunks/b.js', 'static/chunks/matters.js', 'static/chunks/shell.js'],
        ['static/chunks/shell.js', 'static/chunks/courts.js', 'static/chunks/b.js'],
      ),
    ).toEqual(['static/chunks/b.js', 'static/chunks/shell.js']);
    expect(budget.commonChunks()).toEqual([]);
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
      budget: 42 * 1024,
      ok: true,
    });
  });

  it('passes at 42 KB and fails one byte over', () => {
    const at = { 'shell.js': 42 * 1024 };
    expect(budget.shellDelta([], ['shell.js'], at).ok).toBe(true);
    expect(budget.shellDelta([], ['shell.js', 'extra.js'], { ...at, 'extra.js': 1 }).ok).toBe(
      false,
    );
  });
});

describe('courts route budget (#427)', () => {
  it('is 40 KB gzip per route, measured on the courts index and a forum halls tab', () => {
    expect(budget.ROUTE_CHUNK_BUDGET_BYTES).toBe(40 * 1024);
    expect(budget.COURTS_ROUTE_MANIFESTS).toEqual([
      'server/app/(app)/w/[slug]/courts/page_client-reference-manifest.js',
      'server/app/(app)/w/[slug]/courts/[code]/halls/page_client-reference-manifest.js',
    ]);
  });

  it('counts only the chunks neither home nor the workspace shell loads, each once', () => {
    const home = ['static/chunks/root.js'];
    const today = ['static/chunks/root.js', 'static/chunks/shell.js', 'static/chunks/today.js'];
    const courts = [
      'static/chunks/root.js',
      'static/chunks/shell.js',
      'static/chunks/courts.js',
      'static/chunks/courts.js',
    ];
    const delta = budget.shellDelta(
      [...home, ...today],
      courts,
      {
        'static/chunks/root.js': 90_000,
        'static/chunks/shell.js': 28_000,
        'static/chunks/today.js': 5000,
        'static/chunks/courts.js': 2048,
      },
      budget.ROUTE_CHUNK_BUDGET_BYTES,
    );
    expect(delta).toEqual({
      files: ['static/chunks/courts.js'],
      total: 2048,
      budget: 40 * 1024,
      ok: true,
    });
  });

  it('passes at 40 KB and fails one byte over', () => {
    const shared = ['shell.js'];
    const sizes = { 'shell.js': 28_000, 'courts.js': 40 * 1024, 'extra.js': 1 };
    const limit = budget.ROUTE_CHUNK_BUDGET_BYTES;
    expect(budget.shellDelta(shared, ['shell.js', 'courts.js'], sizes, limit).ok).toBe(true);
    expect(budget.shellDelta(shared, ['shell.js', 'courts.js', 'extra.js'], sizes, limit).ok).toBe(
      false,
    );
  });
});

describe('matters route budget (#388)', () => {
  it('is 25 KB gzip, measured on the matters list', () => {
    expect(budget.MATTERS_ROUTE_BUDGET_BYTES).toBe(25 * 1024);
    expect(budget.MATTERS_ROUTE_MANIFEST).toBe(
      'server/app/(app)/w/[slug]/matters/page_client-reference-manifest.js',
    );
  });

  it('counts only chunks beyond home and the shell, and fails one byte over 25 KB', () => {
    const shared = ['root.js', 'shell.js'];
    const limit = budget.MATTERS_ROUTE_BUDGET_BYTES;
    const sizes = { 'root.js': 90_000, 'shell.js': 28_000, 'matters.js': 25 * 1024, 'extra.js': 1 };
    expect(budget.shellDelta(shared, ['root.js', 'shell.js', 'matters.js'], sizes, limit)).toEqual({
      files: ['matters.js'],
      total: 25 * 1024,
      budget: 25 * 1024,
      ok: true,
    });
    expect(budget.shellDelta(shared, ['shell.js', 'matters.js', 'extra.js'], sizes, limit).ok).toBe(
      false,
    );
  });
});

describe('drafting studio route budget (#827)', () => {
  it('pins the budget and route', () => {
    expect(budget.DRAFTS_ROUTE_BUDGET_BYTES).toBe(40 * 1024);
    expect(budget.DRAFTS_ROUTE_MANIFEST).toBe(
      'server/app/(app)/w/[slug]/drafts/[id]/page_client-reference-manifest.js',
    );
  });

  it('keeps the lazy editor chunk out of the initial delta', () => {
    const limit = budget.DRAFTS_ROUTE_BUDGET_BYTES;
    const sizes = { 'shell.js': 28_000, 'studio.js': 30 * 1024, 'editor.js': 80 * 1024 };
    const delta = budget.shellDelta(['shell.js'], ['shell.js', 'studio.js'], sizes, limit);
    expect(delta.ok).toBe(true);
    expect(
      budget.shellDelta(['shell.js'], ['shell.js', 'studio.js', 'editor.js'], sizes, limit).ok,
    ).toBe(false);
  });
});

describe('practice insights route budget (#966)', () => {
  it('pins the budget and route', () => {
    expect(budget.INSIGHTS_ROUTE_BUDGET_BYTES).toBe(40 * 1024);
    expect(budget.INSIGHTS_ROUTE_MANIFEST).toBe(
      'server/app/(app)/w/[slug]/insights/page_client-reference-manifest.js',
    );
  });

  it('counts only chunks beyond shared code against the budget', () => {
    const limit = budget.INSIGHTS_ROUTE_BUDGET_BYTES;
    const sizes = { 'shell.js': 28_000, 'report.js': 30 * 1024, 'extra.js': 20 * 1024 };
    expect(budget.shellDelta(['shell.js'], ['shell.js', 'report.js'], sizes, limit).ok).toBe(true);
    expect(
      budget.shellDelta(['shell.js'], ['shell.js', 'report.js', 'extra.js'], sizes, limit).ok,
    ).toBe(false);
  });
});

describe('timeline route budget (#41)', () => {
  it('is 60 KB gzip, measured on the matter Timeline tab', () => {
    expect(budget.TIMELINE_ROUTE_BUDGET_BYTES).toBe(60 * 1024);
    expect(budget.TIMELINE_ROUTE_MANIFEST).toBe(
      'server/app/(app)/w/[slug]/matters/[id]/timeline/page_client-reference-manifest.js',
    );
  });

  it('treats the matter workspace (Overview route) as shared code', () => {
    expect(budget.MATTER_WORKSPACE_MANIFEST).toBe(
      'server/app/(app)/w/[slug]/matters/[id]/page_client-reference-manifest.js',
    );
  });

  it('counts only chunks beyond shared code, and fails one byte over 60 KB', () => {
    const shared = ['root.js', 'shell.js'];
    const limit = budget.TIMELINE_ROUTE_BUDGET_BYTES;
    const sizes = { 'root.js': 90_000, 'shell.js': 28_000, 'tl.js': 60 * 1024, 'extra.js': 1 };
    expect(budget.shellDelta(shared, ['root.js', 'tl.js'], sizes, limit).ok).toBe(true);
    expect(budget.shellDelta(shared, ['shell.js', 'tl.js', 'extra.js'], sizes, limit).ok).toBe(
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
