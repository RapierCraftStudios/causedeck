// Regression tests for the CI helpers: `node --test infra/scripts/`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { countJunitTests, findProblems, testedPackages } from './check-test-reports.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const junit = (tests) =>
  `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests" tests="${tests}" failures="0">\n</testsuites>\n`;

describe('check-test-reports', () => {
  it('counts tests from the JUnit root element', () => {
    assert.equal(countJunitTests(junit(3)), 3);
    assert.equal(countJunitTests('<testsuite name="x" tests="2"></testsuite>'), 2);
    assert.equal(countJunitTests('not xml'), 0);
  });

  it('only checks packages that define a test script', () => {
    const packages = testedPackages({
      tasks: [
        { task: 'test', package: '@causedeck/ui', directory: 'packages/ui', command: 'vitest run' },
        { task: 'test', package: '@causedeck/e2e', directory: 'e2e', command: '<NONEXISTENT>' },
        { task: 'lint', package: '@causedeck/ui', directory: 'packages/ui', command: 'eslint .' },
      ],
    });
    assert.deepEqual(packages, [{ name: '@causedeck/ui', directory: 'packages/ui' }]);
  });

  const packages = [{ name: '@causedeck/ui', directory: 'packages/ui' }];

  it('fails a package that discovered zero tests', () => {
    const problems = findProblems(packages, '/repo', () => junit(0));
    assert.deepEqual(problems, ['@causedeck/ui: zero tests discovered']);
  });

  it('fails a package with no JUnit report', () => {
    const problems = findProblems(packages, '/repo', () => undefined);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^@causedeck\/ui: no reports\/junit\.xml/);
  });

  it('passes packages that reported tests', () => {
    const read = (file) => {
      assert.equal(file, path.join('/repo', 'packages/ui', 'reports', 'junit.xml'));
      return junit(1);
    };
    assert.deepEqual(findProblems(packages, '/repo', read), []);
  });
});

describe('ci-affected.sh', () => {
  const dryRun = (env, ...args) =>
    execFileSync('bash', [path.join(here, 'ci-affected.sh'), ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, CI_AFFECTED_DRY_RUN: '1', ...env },
    }).trim();

  it('filters pull requests to changed packages and dependents against main', () => {
    assert.equal(
      dryRun({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' }, 'lint'),
      'pnpm turbo run lint --filter=...[origin/main]',
    );
  });

  it('uses the pull request base branch, such as a milestone branch', () => {
    assert.equal(
      dryRun(
        { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'milestone/foundation' },
        'build',
      ),
      'pnpm turbo run build --filter=...[origin/milestone/foundation]',
    );
  });

  it('reads the merge queue base ref', () => {
    assert.equal(
      dryRun({ GITHUB_EVENT_NAME: 'merge_group', CI_BASE_REF: 'refs/heads/main' }, 'typecheck'),
      'pnpm turbo run typecheck --filter=...[origin/main]',
    );
  });

  it('runs everything on push and forwards script args', () => {
    assert.equal(
      dryRun({ GITHUB_EVENT_NAME: 'push' }, 'test', '--', '--coverage'),
      'pnpm turbo run test -- --coverage',
    );
  });
});
