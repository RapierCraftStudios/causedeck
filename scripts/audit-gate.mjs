// Dependency audit gate (#104): `pnpm audit --prod --json`, failing on a high or critical advisory
// that has a patched version, unless an unexpired entry in infra/security/exceptions.yml waives it.
// An expired entry fails the build on its own. Flags: `--report` prints a markdown summary of open
// advisories and exceptions (weekly report), `--check-exceptions` validates the file only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXCEPTIONS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'infra',
  'security',
  'exceptions.yml',
);
export const MAX_EXCEPTION_DAYS = 90;
const FIELDS = ['id', 'package', 'reason', 'owner', 'expires'];
const BLOCKING = new Set(['high', 'critical']);
const DAY_MS = 86_400_000;

/** Parses the flat list format of exceptions.yml (no YAML library: the file has one shape). */
export function parseExceptions(text) {
  const entries = [];
  let current = null;
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^exceptions:\s*\[\s*\]$/.test(line)) return entries;
    if (/^exceptions:\s*$/.test(line)) continue;
    const match = /^\s*(-\s+)?([a-z]+):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`exceptions.yml:${index + 1}: cannot parse "${raw.trim()}"`);
    const [, dash, key, value] = match;
    if (dash) {
      current = {};
      entries.push(current);
    }
    if (!current) throw new Error(`exceptions.yml:${index + 1}: field outside an entry`);
    if (!FIELDS.includes(key)) throw new Error(`exceptions.yml:${index + 1}: unknown field ${key}`);
    current[key] = value.replace(/^['"]|['"]$/g, '').trim();
  }
  return entries;
}

/** Problems with the entries themselves: missing fields, bad or too distant dates, expiry. */
export function checkExceptions(entries, today) {
  const problems = [];
  for (const entry of entries) {
    const label = entry.id ?? '(no id)';
    for (const field of FIELDS) {
      if (!entry[field]) problems.push(`${label}: missing ${field}`);
    }
    if (!entry.expires) continue;
    const expires = Date.parse(`${entry.expires}T23:59:59Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) || Number.isNaN(expires)) {
      problems.push(`${label}: expires must be YYYY-MM-DD`);
    } else if (expires < today.getTime()) {
      problems.push(`${label}: exception expired on ${entry.expires}`);
    } else if (expires - today.getTime() > MAX_EXCEPTION_DAYS * DAY_MS) {
      problems.push(`${label}: expires more than ${MAX_EXCEPTION_DAYS} days ahead`);
    }
  }
  return problems;
}

/** A patched version exists unless the audit reports the "nothing fixes it" range. */
export function hasFix(advisory) {
  const patched = (advisory.patched_versions ?? '').trim();
  return patched !== '' && patched !== '<0.0.0';
}

function waives(entry, advisory) {
  const ids = [advisory.github_advisory_id, String(advisory.id), ...(advisory.cves ?? [])];
  return ids.includes(entry.id) && entry.package === advisory.module_name;
}

/** `advisories` is the `advisories` map of `pnpm audit --json`. */
export function evaluate({ advisories, exceptions, today }) {
  const problems = checkExceptions(exceptions, today);
  const live = exceptions.filter((entry) => !problems.some((p) => p.startsWith(`${entry.id}:`)));
  const open = [];
  const waived = [];
  for (const advisory of Object.values(advisories ?? {})) {
    if (!BLOCKING.has(advisory.severity)) continue;
    const entry = live.find((candidate) => waives(candidate, advisory));
    if (entry) waived.push({ advisory, entry });
    else if (hasFix(advisory)) open.push(advisory);
  }
  return { failures: open, waived, problems };
}

const describeAdvisory = (a) =>
  `${a.severity} ${a.module_name} ${a.vulnerable_versions ?? ''} (${a.github_advisory_id ?? a.id}) fix: ${a.patched_versions ?? 'none'}`;

export function markdownReport({ failures, waived, problems }, exceptions) {
  const lines = [
    '## Weekly security report',
    '',
    `Open high/critical advisories with a fix: ${failures.length}`,
  ];
  for (const a of failures) lines.push(`- ${describeAdvisory(a)}`);
  lines.push('', `Exceptions in force: ${exceptions.length}`);
  for (const e of exceptions)
    lines.push(`- ${e.id} ${e.package}, owner ${e.owner}, expires ${e.expires}`);
  lines.push(
    '',
    `Waived advisories: ${waived.length}`,
    '',
    `Exception problems: ${problems.length}`,
  );
  for (const p of problems) lines.push(`- ${p}`);
  return `${lines.join('\n')}\n`;
}

function runAudit() {
  const result = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // `pnpm audit` exits non-zero when it finds anything; the JSON on stdout is what matters.
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `pnpm audit produced no JSON (exit ${result.status}): ${result.stderr.slice(-400)}`,
    );
  }
}

function main(argv) {
  const exceptions = parseExceptions(readFileSync(EXCEPTIONS_FILE, 'utf8'));
  const today = new Date();
  if (argv.includes('--check-exceptions')) {
    const problems = checkExceptions(exceptions, today);
    for (const p of problems) console.error(`audit-gate: ${p}`);
    return problems.length === 0 ? 0 : 1;
  }
  const outcome = evaluate({ advisories: runAudit().advisories, exceptions, today });
  if (argv.includes('--report')) {
    process.stdout.write(markdownReport(outcome, exceptions));
    return outcome.problems.length === 0 ? 0 : 1;
  }
  for (const p of outcome.problems) console.error(`audit-gate: ${p}`);
  for (const a of outcome.failures) console.error(`audit-gate: ${describeAdvisory(a)}`);
  if (outcome.failures.length === 0 && outcome.problems.length === 0) {
    console.log(`audit-gate: ok (${outcome.waived.length} advisories waived by exceptions)`);
    return 0;
  }
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
