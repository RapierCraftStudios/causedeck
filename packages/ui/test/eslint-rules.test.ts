// The packages/ui lint rules (#129): token-only class names, no `any` in exported props, and the
// shared boundary rules. Fixtures are written to a temp workspace shaped like the repo
// (packages/ui, packages/db, apps/web) and linted with this package's eslint.config.js.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const UI_ESLINT_CONFIG = path.join(import.meta.dirname, '..', 'eslint.config.js');

const FIXTURES: Record<string, string> = {
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2023',
      lib: ['ES2023', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['**/*.ts', '**/*.tsx'],
  }),
  'packages/db/index.ts': 'export const db = 1;\n',
  'apps/web/index.ts': 'export const web = 1;\n',
  'packages/ui/src/arbitrary-colours.ts': [
    "export const a = 'bg-[#fff] p-2';",
    "export const b = 'text-[oklch(0.5_0.1_250)]';",
    "export const c = 'hover:border-[rgb(0,0,0)]';",
    'export const d = `ring-[hsl(10_20%_30%)] ${a}`;',
    "export const e = 'fill-[color:var(--x)]';",
    '',
  ].join('\n'),
  'packages/ui/src/arbitrary-z.ts': [
    "export const a = 'relative z-[5]';",
    "export const b = 'z-10';",
    "export const c = 'md:-z-[1]';",
    '',
  ].join('\n'),
  'packages/ui/src/arbitrary-scales.ts': [
    "export const a = 'rounded-[7px]';",
    "export const b = 'shadow-[0_0_2px_black]';",
    "export const c = 'duration-[180ms] ease-[cubic-bezier(0,0,1,1)]';",
    '',
  ].join('\n'),
  'packages/ui/src/tokens-only.ts': [
    "export const a = 'bg-surface text-ink border-line-control ring-ring z-modal rounded-md shadow-2';",
    "export const b = 'duration-(--dur-fast) ease-standard gap-[inherit] size-4 h-11';",
    "export const c = 'text-[length:var(--text-sm)] [&_svg]:size-4';",
    '',
  ].join('\n'),
  'packages/ui/src/any-props.ts': ['export interface ChipProps {', '  value: any;', '}', ''].join(
    '\n',
  ),
  'packages/ui/src/imports-db.ts': [
    "import { db } from '../../db/index';",
    '',
    'export const value = db;',
    '',
  ].join('\n'),
  'packages/ui/src/imports-app.ts': [
    "import { web } from '../../../apps/web/index';",
    '',
    'export const value = web;',
    '',
  ].join('\n'),
  'packages/ui/src/imports-app-by-name.ts': "export { web } from '@causedeck/web';\n",
  'packages/ui/src/logs-body.ts': [
    'declare const logger: { info: (value: unknown) => void };',
    'declare const request: { body: string };',
    'logger.info(request.body);',
    '',
  ].join('\n'),
};

let root = '';
let eslint: ESLint;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ui-eslint-'));
  for (const [file, contents] of Object.entries(FIXTURES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
  eslint = new ESLint({
    cwd: root,
    overrideConfigFile: UI_ESLINT_CONFIG,
    overrideConfig: { languageOptions: { parserOptions: { tsconfigRootDir: root } } },
  });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

async function lint(file: string) {
  const [result] = await eslint.lintFiles([path.join(root, file)]);
  if (!result) throw new Error(`no result for ${file}`);
  return result;
}

const restrictedLines = (result: ESLint.LintResult) =>
  result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.line);

describe('packages/ui lint rules', () => {
  it('bans arbitrary Tailwind colour values on every colour utility', async () => {
    const result = await lint('packages/ui/src/arbitrary-colours.ts');
    expect(restrictedLines(result)).toEqual([1, 2, 3, 4, 5]);
    expect(result.messages[0]?.message).toContain('Arbitrary colour values are not allowed');
  });

  it('bans z-[n] and numeric z-index utilities', async () => {
    const result = await lint('packages/ui/src/arbitrary-z.ts');
    expect(restrictedLines(result)).toEqual([1, 2, 3]);
    expect(result.messages[0]?.message).toContain('stacking tokens');
  });

  it('bans arbitrary radius, shadow, duration and easing values', async () => {
    const result = await lint('packages/ui/src/arbitrary-scales.ts');
    expect(restrictedLines(result)).toEqual([1, 2, 3]);
  });

  it('accepts token utilities', async () => {
    const result = await lint('packages/ui/src/tokens-only.ts');
    expect(restrictedLines(result)).toEqual([]);
  });

  it('reports `any` in exported props', async () => {
    const result = await lint('packages/ui/src/any-props.ts');
    expect(result.messages.map((m) => m.ruleId)).toContain('@typescript-eslint/no-explicit-any');
  });

  it('keeps ui free of domain packages (boundary lint)', async () => {
    const result = await lint('packages/ui/src/imports-db.ts');
    expect(result.messages.map((m) => m.ruleId)).toContain('boundaries/element-types');
  });

  it('forbids ui from importing apps, by path or by workspace name', async () => {
    const byPath = await lint('packages/ui/src/imports-app.ts');
    expect(byPath.messages.map((m) => m.ruleId)).toContain('boundaries/element-types');

    const byName = await lint('packages/ui/src/imports-app-by-name.ts');
    expect(byName.messages.map((m) => m.message).join('\n')).toContain(
      'Packages must not import apps',
    );
  });

  it('keeps the shared logger-content restriction alongside the token rules', async () => {
    const result = await lint('packages/ui/src/logs-body.ts');
    const messages = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(messages.map((m) => m.message).join('\n')).toContain(
      'Do not log request bodies or matter content',
    );
  });
});
