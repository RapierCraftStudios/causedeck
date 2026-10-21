// packages/adapters lint: the shared Node config plus the no-network rule (#369, ADR 0015). Court
// data reaches an adapter only as a document the lawyer supplied; nothing in src may open a
// connection (no HTTP clients, no headless browsers, no global `fetch`) or name a captcha. The
// flat-config rule options replace the shared ones, so the base import bans and logger-content
// restrictions are re-spread here.
import {
  appImportPattern,
  deepImportPatterns,
  loggerContentRestrictions,
} from '@causedeck/config/eslint/base';
import node from '@causedeck/config/eslint/node';

const NETWORK_MESSAGE =
  'Adapters never make network requests (ADR 0015): parse the document the lawyer supplied.';
const CAPTCHA_MESSAGE = 'Adapters never solicit or solve a captcha (ADR 0011, ADR 0015).';

/** Node built-ins that open connections, imported with or without `node:`. */
const NETWORK_BUILTINS = ['http', 'https', 'http2', 'net', 'tls', 'dgram'];
/** Packages that make requests or drive a browser. */
const NETWORK_PACKAGES = [
  'undici',
  'axios',
  'node-fetch',
  'got',
  'ky',
  'puppeteer',
  'puppeteer-core',
  'playwright',
  'playwright-core',
];
export const NETWORK_MODULES = [
  ...NETWORK_BUILTINS.flatMap((name) => [name, `node:${name}`]),
  ...NETWORK_PACKAGES,
];

const NETWORK_SOURCE = `/^(node:)?(${[...NETWORK_BUILTINS, ...NETWORK_PACKAGES].join('|')})(\\u002F.*)?$|^@playwright\\u002F/`;

export const networkImportRestrictions = {
  paths: NETWORK_MODULES.map((name) => ({ name, message: NETWORK_MESSAGE })),
  patterns: [
    {
      group: [...NETWORK_MODULES.map((name) => `${name}/*`), '@playwright/*'],
      message: NETWORK_MESSAGE,
    },
  ],
};

export const networkGlobalRestrictions = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
].map((name) => ({ name, message: NETWORK_MESSAGE }));

export const networkSyntaxRestrictions = [
  `ImportExpression[source.value=${NETWORK_SOURCE}]`,
  `CallExpression[callee.name='require'][arguments.0.value=${NETWORK_SOURCE}]`,
  'MemberExpression[object.name=/^(globalThis|window|self|global)$/][property.name=/^(fetch|XMLHttpRequest|WebSocket|EventSource)$/]',
].map((selector) => ({ selector, message: NETWORK_MESSAGE }));

export const captchaSyntaxRestrictions = [
  'Identifier[name=/captcha/i]',
  'Literal[value=/captcha/i]',
  'TemplateElement[value.raw=/captcha/i]',
].map((selector) => ({ selector, message: CAPTCHA_MESSAGE }));

const SOURCE_FILES = ['src/**/*.ts'];
const TEST_FILES = ['src/**/__tests__/**', 'src/**/*.test.ts'];

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...node,
  {
    files: SOURCE_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: networkImportRestrictions.paths,
          patterns: [
            ...deepImportPatterns,
            appImportPattern,
            ...networkImportRestrictions.patterns,
          ],
        },
      ],
      'no-restricted-globals': ['error', ...networkGlobalRestrictions],
      // Tests may name a captcha (the rule test does); source may not.
      'no-restricted-syntax': [
        'error',
        ...loggerContentRestrictions,
        ...networkSyntaxRestrictions,
        ...captchaSyntaxRestrictions,
      ],
    },
  },
  {
    files: TEST_FILES,
    rules: {
      'no-restricted-syntax': ['error', ...loggerContentRestrictions, ...networkSyntaxRestrictions],
    },
  },
];
