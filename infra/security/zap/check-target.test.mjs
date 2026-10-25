import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALLOWED_TARGETS,
  assertAllowedTarget,
  parseSuppressions,
  unsuppressedAlerts,
} from './check-target.mjs';

describe('assertAllowedTarget', () => {
  it('accepts the CI compose stack origins', () => {
    assert.equal(assertAllowedTarget('http://localhost'), 'http://localhost');
    assert.equal(assertAllowedTarget('http://localhost/'), 'http://localhost');
    assert.equal(assertAllowedTarget('http://app.localhost/sign-in'), 'http://app.localhost');
  });

  it('refuses production, other hosts and URL tricks', () => {
    for (const bad of [
      'https://app.causedeck.in',
      'https://causedeck.in',
      'https://example.com',
      'http://localhost.evil.com',
      'http://evil.com/?http://localhost',
      'http://localhost@evil.com',
      'http://user:pw@localhost',
      'http://localhost:8080',
      'http://127.0.0.1',
      'https://localhost',
      'ftp://localhost',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'localhost',
      '',
    ]) {
      assert.throws(() => assertAllowedTarget(bad), Error, bad);
    }
  });

  it('refuses everything for an empty allow-list', () => {
    assert.throws(() => assertAllowedTarget('http://localhost', []));
  });

  it('never allow-lists a causedeck production host', () => {
    for (const origin of ALLOWED_TARGETS) assert.doesNotMatch(origin, /causedeck\.in|\.com/);
  });
});

describe('alerts', () => {
  const report = {
    site: [
      {
        alerts: [
          { pluginid: '10038', name: 'CSP', riskcode: '2', riskdesc: 'Medium' },
          { pluginid: '10021', name: 'nosniff', riskcode: '1', riskdesc: 'Low' },
          { pluginid: '40018', name: 'SQLi', riskcode: '3', riskdesc: 'High' },
        ],
      },
    ],
  };

  it('fails on medium and high alerts that are not suppressed', () => {
    assert.deepEqual(
      unsuppressedAlerts(report, [], '2026-01-01').map((a) => a.id),
      ['10038', '40018'],
    );
  });

  it('honours an unexpired suppression and ignores an expired one', () => {
    const rows = parseSuppressions('# header\n10038\tnonce CSP is set by Next\t2026-06-30\n');
    assert.deepEqual(
      unsuppressedAlerts(report, rows, '2026-01-01').map((a) => a.id),
      ['40018'],
    );
    assert.equal(unsuppressedAlerts(report, rows, '2026-07-01').length, 2);
  });

  it('rejects a malformed suppression row', () => {
    assert.throws(() => parseSuppressions('10038\tno expiry\n'));
  });
});
