// Flaky-count gate (#995). Reads a Playwright JSON report (E2E_JSON_REPORT) and fails when more
// tests passed only on retry than E2E_FLAKY_BUDGET allows, so a creeping flake rate fails the job
// instead of hiding behind `retries`. Lists the flaky tests in the log and the job summary.
// Usage: node support/flaky-budget.mjs <report.json> [budget]
import { appendFileSync, readFileSync } from 'node:fs';

const [file, budgetArg] = process.argv.slice(2);
// eslint-disable-next-line no-process-env -- CI passes the budget through the environment.
const env = process.env;
const budget = Number(budgetArg ?? env.E2E_FLAKY_BUDGET ?? 10);
if (!file || !Number.isFinite(budget)) {
  console.error('usage: node support/flaky-budget.mjs <report.json> [budget]');
  process.exit(2);
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const flaky = [];
const walk = (suite, titles) => {
  const path = suite.title ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status === 'flaky') {
        flaky.push(`[${test.projectName}] ${[...path, spec.title].join(' > ')}`);
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, path);
};
for (const suite of report.suites ?? []) walk(suite, []);

const lines = [`Flaky tests: ${String(flaky.length)} (budget ${String(budget)})`, ...flaky];
console.log(lines.join('\n'));
if (env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    env.GITHUB_STEP_SUMMARY,
    `### e2e flaky tests\n\n${lines.map((l, i) => (i === 0 ? l : `- ${l}`)).join('\n')}\n`,
  );
}
if (flaky.length > budget) {
  console.error(`e2e: ${String(flaky.length)} flaky tests exceed the budget of ${String(budget)}.`);
  process.exit(1);
}
