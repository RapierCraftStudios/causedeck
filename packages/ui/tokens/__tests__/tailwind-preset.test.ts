import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

/** Absolute path of the Tailwind CLI entry, from @tailwindcss/cli's `bin` field. */
function tailwindCli(): string {
  const pkgPath = require.resolve('@tailwindcss/cli/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: Record<string, string> };
  return path.join(path.dirname(pkgPath), pkg.bin.tailwindcss ?? '');
}

const FIXTURE_CLASSES =
  'bg-surface text-ink border-line rounded-lg shadow-2 font-serif tabular-nums';

describe('Tailwind v4 preset', () => {
  let dir = '';
  let css = '';

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'causedeck-preset-'));
    writeFileSync(
      path.join(dir, 'index.html'),
      `<main class="${FIXTURE_CLASSES}"><p class="dark:bg-surface-raised text-display z-modal animate-fade-in">x</p></main>`,
    );
    // Imports go through package exports, so a broken export map fails here too.
    const input = [
      `@import '${require.resolve('tailwindcss/index.css')}' source(none);`,
      `@import '${require.resolve('@causedeck/ui/tokens.css')}';`,
      `@import '${require.resolve('@causedeck/config/tailwind/preset.css')}';`,
      `@source '${path.join(dir, 'index.html')}';`,
    ].join('\n');
    writeFileSync(path.join(dir, 'input.css'), input);
    execFileSync(
      process.execPath,
      [tailwindCli(), '-i', path.join(dir, 'input.css'), '-o', path.join(dir, 'out.css')],
      { stdio: 'pipe' },
    );
    css = readFileSync(path.join(dir, 'out.css'), 'utf8');
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const rule = (selector: string): string => {
    const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `missing rule ${selector}`).not.toBeNull();
    return match?.[1]?.replaceAll(/\s+/g, ' ').trim() ?? '';
  };

  it('maps colour utilities to the semantic tokens', () => {
    expect(rule('.bg-surface')).toBe('background-color: var(--surface);');
    expect(rule('.text-ink')).toBe('color: var(--ink);');
    expect(rule('.border-line')).toBe('border-color: var(--line);');
  });

  it('maps radius, shadow and font utilities to the token scales', () => {
    expect(rule('.rounded-lg')).toBe('border-radius: var(--radius-lg);');
    expect(rule('.shadow-2')).toContain('--tw-shadow: var(--shadow-2);');
    expect(rule('.font-serif')).toBe('font-family: var(--font-serif);');
    expect(rule('.text-display')).toContain('font-size: var(--text-display);');
  });

  it('keeps tabular-nums', () => {
    expect(rule('.tabular-nums')).toContain('--tw-numeric-spacing: tabular-nums;');
  });

  it('switches dark mode on the `dark` class', () => {
    expect(css).toContain('.dark\\:bg-surface-raised:where(.dark, .dark *)');
  });

  it('exposes semantic z-index and motion utilities', () => {
    expect(rule('.z-modal')).toBe('z-index: var(--z-modal);');
    expect(rule('.animate-fade-in')).toBe(
      'animation: fade-in var(--dur-base) var(--ease-enter) both;',
    );
    expect(css).toMatch(/@keyframes fade-in/);
  });

  it('drops the default Tailwind palette and never re-declares a token as itself', () => {
    expect(css).not.toMatch(/--color-red-500/);
    const cycles = [...css.matchAll(/(--[\w-]+):\s*var\((--[\w-]+)\)/g)].filter(
      ([, a, b]) => a === b,
    );
    expect(cycles.map(([decl]) => decl)).toEqual([]);
  });
});
