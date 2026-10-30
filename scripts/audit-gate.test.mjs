// `node --test scripts/audit-gate.test.mjs` (#104): the audit gate's decisions on fixture advisories.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  EXCEPTIONS_FILE,
  checkExceptions,
  evaluate,
  hasFix,
  parseExceptions,
} from './audit-gate.mjs';

const today = new Date('2026-10-25T12:00:00Z');
const advisory = (over = {}) => ({
  id: 1100001,
  github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
  module_name: 'left-pad',
  severity: 'critical',
  patched_versions: '>=1.3.1',
  cves: ['CVE-2026-0001'],
  ...over,
});
const entry = (over = {}) => ({
  id: 'GHSA-aaaa-bbbb-cccc',
  package: 'left-pad',
  reason: 'not reachable',
  owner: 'dev',
  expires: '2026-12-01',
  ...over,
});
const run = (advisories, exceptions = []) =>
  evaluate({ advisories: Object.fromEntries(advisories.map((a, i) => [i, a])), exceptions, today });

describe('audit gate', () => {
  it('fails a critical or high advisory that has a fix', () => {
    assert.equal(run([advisory()]).failures.length, 1);
    assert.equal(run([advisory({ severity: 'high' })]).failures.length, 1);
  });
  it('ignores moderate advisories and advisories without a fix', () => {
    assert.equal(run([advisory({ severity: 'moderate' })]).failures.length, 0);
    assert.equal(run([advisory({ patched_versions: '<0.0.0' })]).failures.length, 0);
    assert.equal(hasFix({ patched_versions: '' }), false);
  });
  it('passes an advisory waived by an unexpired exception', () => {
    const outcome = run([advisory()], [entry()]);
    assert.deepEqual(
      [outcome.failures.length, outcome.problems.length, outcome.waived.length],
      [0, 0, 1],
    );
  });
  it('matches an exception by CVE id too, but only for the same package', () => {
    assert.equal(run([advisory()], [entry({ id: 'CVE-2026-0001' })]).failures.length, 0);
    assert.equal(run([advisory()], [entry({ package: 'other' })]).failures.length, 1);
  });
  it('fails on an expired exception and no longer waives with it', () => {
    const outcome = run([advisory()], [entry({ expires: '2026-10-01' })]);
    assert.match(outcome.problems.join('\n'), /expired on 2026-10-01/);
    assert.equal(outcome.failures.length, 1);
  });
  it('rejects missing fields, bad dates and exceptions more than 90 days out', () => {
    assert.match(checkExceptions([entry({ owner: '' })], today).join(), /missing owner/);
    assert.match(checkExceptions([entry({ expires: 'soon' })], today).join(), /YYYY-MM-DD/);
    assert.match(checkExceptions([entry({ expires: '2027-06-01' })], today).join(), /90 days/);
  });
});

describe('exceptions.yml', () => {
  it('parses the committed file with no problems', () => {
    const entries = parseExceptions(readFileSync(EXCEPTIONS_FILE, 'utf8'));
    assert.deepEqual(checkExceptions(entries, today), []);
  });
  it('parses entries and rejects unknown fields', () => {
    const text = `exceptions:\n  - id: GHSA-aaaa-bbbb-cccc # note\n    package: left-pad\n    reason: r\n    owner: o\n    expires: 2026-12-01\n`;
    assert.deepEqual(parseExceptions(text), [entry({ reason: 'r', owner: 'o' })]);
    assert.throws(() => parseExceptions('exceptions:\n  - bogus: 1\n'), /unknown field/);
  });
});
