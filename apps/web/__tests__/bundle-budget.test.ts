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
