// Runs the retention proof in fixture (time-travel) mode: no Loki needed.
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'log-retention',
  'verify-retention.sh',
);

describe('verify-retention.sh', () => {
  it('keeps logs older than 170 days through compaction in the fixture', () => {
    const result = spawnSync('bash', [script, '--fixture'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /older than 170 days survive/);
  });

  it('rejects an unknown mode', () => {
    const result = spawnSync('bash', [script, '--bogus'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  });
});
