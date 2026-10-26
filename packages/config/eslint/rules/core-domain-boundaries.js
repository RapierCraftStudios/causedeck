// `causedeck/core-domain-boundaries` (#293, docs/engineering/core-domains.md): the domains of
// `@causedeck/core` (one folder each under packages/core/src/) import one another only through the
// other domain's `index.ts`, and only along the edges declared in `CORE_DOMAIN_DEPENDENCIES`
// (../core-domains.js). `shared/` holds helpers no domain owns: anyone may import it, and it imports
// no domain. Tests may import any domain, but only through its `index.ts`. Root files
// (src/index.ts, src/*.test.ts, src/__tests__/**) may import domains through their `index.ts`. Syntax
// only: no type information needed.
import path from 'node:path';

import { CORE_DOMAIN_DEPENDENCIES } from '../core-domains.js';

const SRC_MARKER = 'packages/core/src/';
const INDEX_FORMS = new Set(['', 'index', 'index.ts', 'index.js']);
const TEST_FILE = /(^|\/)__tests__\/|\.test\.[cm]?[jt]sx?$/;

/** @typedef {'deepImport' | 'undeclaredDependency' | 'sharedImportsDomain' | 'unknownDomain'} CoreImportProblem */

/** @param {string} name */
const isDomain = (name) => name !== 'shared' && Object.hasOwn(CORE_DOMAIN_DEPENDENCIES, name);

/**
 * The area of a path relative to packages/core/src/: a top-level folder name, or `root` for
 * src/*.ts and src/__tests__/**.
 *
 * @param {string[]} segments
 */
function areaOf(segments) {
  if (segments.length <= 1 || segments[0] === '__tests__') return 'root';
  return /** @type {string} */ (segments[0]);
}

/** @param {string} area */
const isKnown = (area) => area === 'root' || Object.hasOwn(CORE_DOMAIN_DEPENDENCIES, area);

/**
 * Checks one import of a core source file. Returns null when it is allowed (or out of scope: not a
 * core file, a package specifier, a same-domain or shared import), else the problem's messageId.
 *
 * @param {string} filename
 * @param {string} specifier
 * @param {{ isTest?: boolean }} [options] defaults to whether `filename` is a test file
 * @returns {CoreImportProblem | null}
 */
export function checkCoreImport(filename, specifier, options = {}) {
  const normalized = filename.replaceAll('\\', '/');
  const at = normalized.lastIndexOf(SRC_MARKER);
  if (at === -1 || !specifier.startsWith('.')) return null;
  const relative = normalized.slice(at + SRC_MARKER.length);
  const isTest = options.isTest ?? TEST_FILE.test(relative);

  const own = areaOf(relative.split('/'));
  if (!isKnown(own)) return 'unknownDomain';

  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
  if (resolved === '..' || resolved.startsWith('../')) return null;
  const targetSegments = resolved.split('/');
  const target = areaOf(targetSegments);
  if (target === 'root' || target === own || target === 'shared') return null;
  if (!isKnown(target)) return 'unknownDomain';

  if (own === 'shared') return 'sharedImportsDomain';
  if (!INDEX_FORMS.has(targetSegments.slice(1).join('/'))) return 'deepImport';
  if (!isTest && isDomain(own) && !CORE_DOMAIN_DEPENDENCIES[own]?.includes(target)) {
    return 'undeclaredDependency';
  }
  return null;
}

/** @param {string} relative */
const ownArea = (relative) => areaOf(relative.split('/'));

/** @type {import('eslint').Rule.RuleModule} */
export const coreDomainBoundaries = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Core domains import one another only through `index.ts` and along the declared dependency map; `shared/` imports no domain.',
      url: 'https://github.com/RapierCraftStudios/lawyer-os/blob/main/docs/engineering/core-domains.md',
    },
    schema: [],
    messages: {
      deepImport:
        'Import `{{specifier}}` through the domain entry point (`../<domain>/index.ts`), not its internal files.',
      undeclaredDependency:
        'The `{{own}}` domain may not import `{{specifier}}`: add the edge to CORE_DOMAIN_DEPENDENCIES (packages/config/eslint/core-domains.js) or move the helper to `shared/`.',
      sharedImportsDomain:
        '`shared/` must not import a domain (`{{specifier}}`); move the code it needs into `shared/`.',
      unknownDomain:
        '`{{specifier}}` involves a packages/core/src/ folder that is not a declared domain: add it to CORE_DOMAIN_DEPENDENCIES (packages/config/eslint/core-domains.js).',
    },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const at = filename.lastIndexOf(SRC_MARKER);
    if (at === -1) return {};
    const own = ownArea(filename.slice(at + SRC_MARKER.length));

    /** @param {import('estree').Node | null | undefined} source */
    const check = (source) => {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') return;
      const specifier = source.value;
      const problem = checkCoreImport(filename, specifier);
      if (problem) context.report({ node: source, messageId: problem, data: { specifier, own } });
    };

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};
