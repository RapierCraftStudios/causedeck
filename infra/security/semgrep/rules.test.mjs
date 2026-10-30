// Semgrep rules (#104): every rule id has a passing (`ok:`) and a failing (`ruleid:`) fixture, and the
// workflow runs `semgrep --test` from a digest-pinned image without secrets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const rules = read('./rules.yml');
const fixtures = read('./fixtures/rules.ts') + read('./fixtures/rules.tsx');
const workflow = read('../../../.github/workflows/semgrep.yml');
const ids = [...rules.matchAll(/^\s+- id:\s*(\S+)/gm)].map((m) => m[1]);

describe('semgrep rules', () => {
  it('define the four required rules', () => {
    assert.deepEqual(
      ids.sort(),
      [
        'causedeck.fetch-to-unlisted-host',
        'causedeck.l5-automation-action',
        'causedeck.raw-sql-bypasses-with-workspace',
        'causedeck.unsafe-html-injection',
      ].sort(),
    );
  });

  for (const id of ids) {
    it(`${id} has a failing and a passing fixture`, () => {
      assert.match(fixtures, new RegExp(`// ruleid: ${id.replaceAll('.', '\\.')}\\b`));
      assert.match(fixtures, new RegExp(`// ok: ${id.replaceAll('.', '\\.')}\\b`));
    });
  }
});

describe('semgrep workflow', () => {
  it('runs on pull requests and weekly', () => {
    assert.match(workflow, /^\s+pull_request:/m);
    assert.match(workflow, /cron:/);
  });

  it('uses a digest-pinned image, no marketplace action and no secrets', () => {
    assert.match(workflow, /semgrep\/semgrep:[\d.]+@sha256:[0-9a-f]{64}/);
    assert.doesNotMatch(workflow, /returntocorp\/semgrep-action|semgrep\/semgrep-action/);
    assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  });

  it('checks the fixtures with semgrep --test and scans apps and packages', () => {
    assert.match(workflow, /semgrep --test/);
    assert.match(workflow, /--config infra\/security\/semgrep\/rules\.yml/);
    assert.match(workflow, /apps packages|apps\/ packages\//);
  });
});
