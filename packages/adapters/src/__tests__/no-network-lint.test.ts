// The no-network rule (#369, ADR 0015): ESLint resolves packages/adapters/eslint.config.js for a
// src file, and the network and captcha restrictions it yields fail each forbidden snippet while
// leaving a pure parser alone. A source scan backs the captcha rule up for comments and strings.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { ESLint, Linter } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = path.join(PACKAGE_ROOT, 'src');
const RULES = ['no-restricted-imports', 'no-restricted-globals', 'no-restricted-syntax'];

let rules: Linter.RulesRecord = {};

beforeAll(async () => {
  const eslint = new ESLint({ cwd: PACKAGE_ROOT });
  const config = (await eslint.calculateConfigForFile(path.join(SRC, 'probe.ts'))) as Linter.Config;
  rules = Object.fromEntries(
    Object.entries(config.rules ?? {}).filter(([name]) => RULES.includes(name)),
  ) as Linter.RulesRecord;
});

function lint(code: string): Linter.LintMessage[] {
  return new Linter({ configType: 'flat' }).verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules,
      },
    ],
    path.join(SRC, 'probe.ts'),
  );
}

const FORBIDDEN: [string, string][] = [
  ['node:http', "import http from 'node:http';"],
  ['node:https', "import { request } from 'node:https';"],
  ['http', "import http from 'http';"],
  ['https', "import https from 'https';"],
  ['undici', "import { request } from 'undici';"],
  ['axios', "import axios from 'axios';"],
  ['node-fetch', "import fetchIt from 'node-fetch';"],
  ['puppeteer', "import puppeteer from 'puppeteer';"],
  ['playwright', "import { chromium } from 'playwright';"],
  ['@playwright/test', "import { test } from '@playwright/test';"],
  ['undici subpath', "import { Agent } from 'undici/agent';"],
  ['re-export', "export { request } from 'undici';"],
  ['dynamic import', "await import('axios');"],
  ['require', "require('node:https');"],
  ['bare fetch', "await fetch('https://example.test');"],
  ['globalThis.fetch', "await globalThis.fetch('https://example.test');"],
  ['XMLHttpRequest', 'new XMLHttpRequest();'],
  ['WebSocket', "new WebSocket('wss://example.test');"],
  ['captcha identifier', 'export function solveCaptcha() { return 1; }'],
  ['captcha string', "export const field = 'g-recaptcha-response';"],
];

describe('no-network lint rule for packages/adapters/src', () => {
  it('applies the restrictions to src files', () => {
    expect(Object.keys(rules).sort()).toEqual([...RULES].sort());
  });

  it.each(FORBIDDEN)('fails %s', (_name, code) => {
    const messages = lint(code);
    expect(messages.filter((m) => m.fatal === true)).toEqual([]);
    expect(messages.map((m) => m.ruleId)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^no-restricted-(imports|globals|syntax)$/)]),
    );
  });

  it('allows a pure parser and keeps the shared deep-import ban', () => {
    expect(
      lint(
        "import { z } from 'zod';\nexport const parse = (text) => z.string().parse(text).split('\\n');",
      ),
    ).toEqual([]);
    expect(
      lint("import { x } from '@causedeck/flags/src/access-mode';").map((m) => m.ruleId),
    ).toEqual(['no-restricted-imports']);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return name === '__tests__' ? [] : sourceFiles(file);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [file] : [];
  });
}

describe('no captcha code path', () => {
  it('no adapters source file mentions a captcha', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(5);
    expect(files.filter((file) => /captcha/i.test(readFileSync(file, 'utf8')))).toEqual([]);
  });
});
