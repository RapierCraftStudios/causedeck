// `pnpm check:no-l5` (#47, PRD TR-1): the structural guard that keeps the automation ladder at L4.
// It fails when
//   1. a fifth level (the token L5..L9) appears in the code of any `packages/*/src` or `apps/*/src`
//      file; comments, tests, fixtures and stories are not scanned, and neither is this guard;
//   2. the proposal-kind registry (`PROPOSAL_KINDS`) holds a kind that sends, files, pays, advises,
//      accepts an engagement or inserts or generates a citation;
//   3. a handler under `packages/core/src/automation/handlers` registers a kind that is not in that
//      registry, or one of the forbidden kinds;
//   4. a handler module (or anything else in the automation domain) imports `notifications` or an
//      outward transport (mail, SMS, WhatsApp, webhooks), so the engine has no send path.
// It runs with Node's type stripping (no build step), so it uses only erasable TypeScript syntax.
// `--root <dir>` points it at another tree (the tests use fixtures).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface Violation {
  rule: 'fifth-level' | 'forbidden-kind' | 'unknown-handler-kind' | 'outward-import';
  file: string;
  line: number;
  message: string;
}

/** Kind names the engine never has (whole underscore-separated words). */
export const FORBIDDEN_KIND =
  /(^|_)(send|file|e_file|pay|advise|accept_engagement|insert_citation|generate_citation|auto_reply)(_|$)/;

/** Import specifiers that reach a way to send something outward. */
export const OUTWARD_IMPORT =
  /(^|[/@._-])(notifications?|nodemailer|mailer|sendgrid|resend|postmark|twilio|whatsapp|sms|smtp|webhooks?)([/@._-]|$)/i;

const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '__tests__',
  '__fixtures__',
]);
const SKIP_FILE = /\.(?:test|spec|stories|bench)\.[cm]?[jt]sx?$/;

/** `source` with comments blanked (newlines kept), leaving strings and code. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      out += ch;
      i++;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') {
          out += source[i] as string;
          i++;
        }
        if (ch !== '`' && source[i] === '\n') break;
        out += source[i] ?? '';
        i++;
      }
      out += ch;
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function walk(dir: string, into: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries.sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(full, into);
    } else if (SOURCE_EXT.test(name) && !SKIP_FILE.test(name) && !name.endsWith('.d.ts')) {
      into.push(full);
    }
  }
}

/** Every scanned source file: packages and apps source folders under `root`. */
export function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const group of ['packages', 'apps']) {
    let names: string[] = [];
    try {
      names = readdirSync(path.join(root, group));
    } catch {
      continue;
    }
    for (const name of names.sort()) walk(path.join(root, group, name, 'src'), files);
  }
  return files;
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

function fifthLevel(root: string): Violation[] {
  const violations: Violation[] = [];
  for (const file of sourceFiles(root)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(/\bL[5-9]\b/g)) {
      violations.push({
        rule: 'fifth-level',
        file: path.relative(root, file),
        line: lineOf(code, match.index),
        message: `"${match[0]}": the automation ladder stops at L4`,
      });
    }
  }
  return violations;
}

/** The kinds of `PROPOSAL_KINDS = [...]` in the validators' proposal-draft module. */
export function registryKinds(root: string): { kinds: string[]; file: string } {
  const file = path.join('packages', 'validators', 'src', 'proposal-draft.ts');
  let text = '';
  try {
    text = readFileSync(path.join(root, file), 'utf8');
  } catch {
    return { kinds: [], file };
  }
  const body = /PROPOSAL_KINDS\s*=\s*\[([^\]]*)\]/.exec(stripComments(text))?.[1] ?? '';
  return { kinds: [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string), file };
}

function forbiddenKinds(root: string): Violation[] {
  const { kinds, file } = registryKinds(root);
  return kinds
    .filter((kind) => FORBIDDEN_KIND.test(kind))
    .map((kind) => ({
      rule: 'forbidden-kind' as const,
      file,
      line: 1,
      message: `"${kind}" is an action the engine never performs`,
    }));
}

const AUTOMATION_DIR = path.join('packages', 'core', 'src', 'automation');

function automationFiles(root: string): string[] {
  const files: string[] = [];
  walk(path.join(root, AUTOMATION_DIR), files);
  return files;
}

function handlerKinds(root: string): Violation[] {
  const { kinds } = registryKinds(root);
  const known = new Set(kinds);
  const violations: Violation[] = [];
  for (const file of automationFiles(root)) {
    const rel = path.relative(root, file);
    if (!rel.startsWith(path.join(AUTOMATION_DIR, 'handlers') + path.sep)) continue;
    if (path.basename(file) === 'index.ts' || path.basename(file) === 'common.ts') continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    const declared = [
      ...code.matchAll(/\bkind:\s*'([a-z_]+)'/g),
      ...code.matchAll(/disabledHandler\(\s*'([a-z_]+)'/g),
    ];
    for (const match of declared) {
      const kind = match[1] as string;
      if (FORBIDDEN_KIND.test(kind)) {
        violations.push({
          rule: 'forbidden-kind',
          file: rel,
          line: lineOf(code, match.index),
          message: `a handler for "${kind}", an action the engine never performs`,
        });
      } else if (!known.has(kind)) {
        violations.push({
          rule: 'unknown-handler-kind',
          file: rel,
          line: lineOf(code, match.index),
          message: `a handler for "${kind}", which is not in PROPOSAL_KINDS`,
        });
      }
    }
  }
  return violations;
}

function outwardImports(root: string): Violation[] {
  const violations: Violation[] = [];
  for (const file of automationFiles(root)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const specifier = /\b(?:from|import)\s*\(?\s*'([^']+)'/g;
    for (const match of code.matchAll(specifier)) {
      const target = match[1] as string;
      if (OUTWARD_IMPORT.test(target)) {
        violations.push({
          rule: 'outward-import',
          file: path.relative(root, file),
          line: lineOf(code, match.index),
          message: `imports "${target}": the engine has no send path (outward drafts are #69)`,
        });
      }
    }
  }
  return violations;
}

export function checkNoL5(root: string): Violation[] {
  return [
    ...fifthLevel(root),
    ...forbiddenKinds(root),
    ...handlerKinds(root),
    ...outwardImports(root),
  ];
}

function main(): number {
  const flag = process.argv.indexOf('--root');
  const root =
    flag === -1
      ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
      : path.resolve(process.argv[flag + 1] ?? '.');
  const violations = checkNoL5(root);
  if (violations.length > 0) {
    console.error(`check:no-l5 failed (${String(violations.length)}):`);
    for (const v of violations)
      console.error(`  ${v.file}:${String(v.line)} [${v.rule}] ${v.message}`);
    return 1;
  }
  console.log(
    `check:no-l5: ${String(sourceFiles(root).length)} files scanned, no fifth level or send path.`,
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
