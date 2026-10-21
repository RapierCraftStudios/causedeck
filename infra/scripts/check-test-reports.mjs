// Fail CI when a workspace's test task ran but discovered zero tests (a silently skipped suite).
//
//   node infra/scripts/check-test-reports.mjs
//
// The package set is the one Turborepo ran for `test` with TURBO_FILTER (written by ci-affected.sh;
// empty means every workspace; several filters are separated by spaces). CI_TEST_SHARD_EMPTY=1 means
// the shard had nothing to run. Each package with a `test` script must have produced
// `<dir>/reports/junit.xml` reporting at least one test.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPORT_PATH = path.join('reports', 'junit.xml');

/** Total test count from a JUnit document's root `<testsuites tests="N">` (or `<testsuite>`). */
export function countJunitTests(xml) {
  const root = /<testsuites?\b[^>]*>/.exec(xml);
  if (!root) return 0;
  const tests = /\btests="(\d+)"/.exec(root[0]);
  return tests ? Number(tests[1]) : 0;
}

/**
 * Workspaces whose `test` script is not a unit suite: `@causedeck/e2e` is Playwright, skipped under
 * Turborepo (see e2e/playwright.config.ts) and run by the e2e workflow instead.
 */
export const NOT_UNIT_TESTED = new Set(['@causedeck/e2e']);

/** Workspaces whose `test` task Turborepo would run, from `turbo run test --dry=json` output. */
export function testedPackages(dryRun) {
  return dryRun.tasks
    .filter((task) => task.task === 'test' && task.command !== '<NONEXISTENT>')
    .filter((task) => !NOT_UNIT_TESTED.has(task.package))
    .map((task) => ({ name: task.package, directory: task.directory }));
}

/** Problems for packages whose report is missing or counts zero tests; empty when all is well. */
export function findProblems(packages, root, readReport = defaultReadReport) {
  const problems = [];
  for (const pkg of packages) {
    const xml = readReport(path.join(root, pkg.directory, REPORT_PATH));
    if (xml === undefined) {
      problems.push(
        `${pkg.name}: no ${REPORT_PATH} (did the test task run with the junit reporter?)`,
      );
    } else if (countJunitTests(xml) === 0) {
      problems.push(`${pkg.name}: zero tests discovered`);
    }
  }
  return problems;
}

function defaultReadReport(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function turboDryRun(root, filter) {
  const args = ['run', 'test', '--dry=json'];
  // TURBO_FILTER holds one filter, or several separated by spaces (a CI test shard's packages).
  for (const one of filter.split(/\s+/).filter(Boolean)) args.push(`--filter=${one}`);
  const turbo = path.join(root, 'node_modules', '.bin', 'turbo');
  return JSON.parse(
    execFileSync(turbo, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
  );
}

function main() {
  if (process.env.CI_TEST_SHARD_EMPTY === '1') {
    console.log('Test discovery check skipped: this shard has no affected packages.');
    return;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const packages = testedPackages(turboDryRun(root, process.env.TURBO_FILTER ?? ''));
  const problems = findProblems(packages, root);
  if (problems.length > 0) {
    console.error(`Test discovery check failed for ${problems.length} package(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`Test discovery check passed: ${packages.length} package(s) reported tests.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
