import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BUDGETS, measureExport, overBudget, sideEffectsProblems } from './check-bundle-size';

const pkg = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'),
) as { sideEffects?: unknown; exports: Record<string, string> };

describe('bundle check', () => {
  it('requires sideEffects ["**/*.css"]', () => {
    expect(sideEffectsProblems(pkg)).toEqual([]);
    expect(sideEffectsProblems({ sideEffects: false })).toHaveLength(1);
    expect(sideEffectsProblems({})).toHaveLength(1);
  });

  it('flags exports over budget', () => {
    const size = { entry: './button', bytes: 1, gzip: 1, budget: 6144 };
    expect(overBudget([{ ...size, added: 6144 }])).toEqual([]);
    expect(overBudget([{ ...size, added: 6145 }])).toHaveLength(1);
  });

  it('gives every component a subpath export', () => {
    for (const name of [
      'button',
      'spinner',
      'kbd',
      'accordion',
      'alert',
      'alert-dialog',
      'avatar',
      'badge',
      'breadcrumb',
      'card',
      'chart',
      'collapsible',
      'command',
      'context-menu',
      'dialog',
      'drawer',
      'dropdown-menu',
      'empty-state',
      'hover-card',
      'icon-button',
      'menubar',
      'pagination',
      'popover',
      'progress',
      'resizable',
      'scroll-area',
      'separator',
      'sheet',
      'shortcuts-dialog',
      'skeleton',
      'sonner',
      'tabs',
      'tooltip',
    ]) {
      expect(pkg.exports[`./${name}`]).toBe(`./src/components/${name}/index.ts`);
    }
  });

  it('budgets every component subpath export', () => {
    const components = Object.keys(pkg.exports).filter((key) =>
      pkg.exports[key]?.startsWith('./src/components/'),
    );
    expect(Object.keys(BUDGETS).sort()).toEqual(components.sort());
  });

  it('keeps @causedeck/ui/button within 6 KB gzip', async () => {
    const size = await measureExport('./button', BUDGETS['./button'] ?? 0);
    expect(size.budget).toBe(6 * 1024);
    expect(size.added).toBeGreaterThan(0);
    expect(size.added).toBeLessThanOrEqual(6 * 1024);
  });
});
