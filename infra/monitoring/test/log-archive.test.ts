// The lean log path (#886): 180 days in an India bucket, ap-south-2 by default, never elsewhere.
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'log-retention');
const script = path.join(dir, 'archive-logs.sh');
const tmp = mkdtempSync(path.join(tmpdir(), 'log-archive-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const baseEnv = {
  PATH: process.env.PATH ?? '',
  LOG_ARCHIVE_ENDPOINT: 'https://s3.ap-south-2.amazonaws.com',
  LOG_ARCHIVE_ACCESS_KEY: 'placeholder-access',
  LOG_ARCHIVE_SECRET_KEY: 'placeholder-secret',
  LOG_ARCHIVE_BUCKET: 'causedeck-logs-archive',
  LOG_ARCHIVE_HOST_ID: 'vps1',
};

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...baseEnv, ...env } });
}

describe('archive-logs.sh region and endpoint guard', () => {
  it('defaults to ap-south-2 (Hyderabad)', () => {
    const result = run(['--check-config']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /region ap-south-2/);
  });

  it('accepts the other India region', () => {
    const result = run(['--check-config'], {
      LOG_ARCHIVE_REGION: 'ap-south-1',
      LOG_ARCHIVE_ENDPOINT: 'https://s3.ap-south-1.amazonaws.com',
    });
    assert.equal(result.status, 0, result.stderr);
  });

  for (const region of ['us-east-1', 'eu-west-1', 'ap-southeast-1', 'ap-south-3', '']) {
    it(`rejects region '${region}'`, () => {
      const result = run(['--check-config'], { LOG_ARCHIVE_REGION: region || 'none' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /outside India/);
    });
  }

  it('rejects a non-India endpoint even with an India region', () => {
    const result = run(['--check-config'], {
      LOG_ARCHIVE_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not an allowed India endpoint/);
  });

  it('allows MinIO on the host only with ALLOW_LOCAL_ENDPOINTS=1', () => {
    const local = { LOG_ARCHIVE_ENDPOINT: 'http://minio:9000' };
    assert.notEqual(run(['--check-config'], local).status, 0);
    assert.equal(run(['--check-config'], { ...local, ALLOW_LOCAL_ENDPOINTS: '1' }).status, 0);
  });

  it('requires credentials and an endpoint', () => {
    assert.notEqual(run(['--check-config'], { LOG_ARCHIVE_ACCESS_KEY: '' }).status, 0);
    assert.notEqual(run(['--check-config'], { LOG_ARCHIVE_ENDPOINT: '' }).status, 0);
  });
});

describe('archive-logs.sh upload', () => {
  it('uploads rotated gzip files under a dated key and removes them after upload', () => {
    const logs = path.join(tmp, 'containers');
    const container = path.join(logs, 'abcdef0123456789');
    mkdirSync(container, { recursive: true });
    writeFileSync(path.join(container, 'abcdef0123456789-json.log-20261001.gz'), 'x');
    writeFileSync(path.join(container, 'abcdef0123456789-json.log'), 'live');
    const calls = path.join(tmp, 'mc-calls');
    const mc = path.join(tmp, 'mc');
    writeFileSync(mc, `#!/bin/sh\necho "$@" >> "${calls}"\n`);
    chmodSync(mc, 0o755);

    const dry = run(['--dry-run'], { DOCKER_LOG_DIR: logs, MC_BIN: mc });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(
      dry.stdout,
      /archive\/causedeck-logs-archive\/docker\/vps1\/2026-10-01\/abcdef012345\.json\.log\.gz/,
    );
    assert.ok(existsSync(path.join(container, 'abcdef0123456789-json.log-20261001.gz')));

    const real = run([], { DOCKER_LOG_DIR: logs, MC_BIN: mc });
    assert.equal(real.status, 0, real.stderr);
    assert.match(
      readFileSync(calls, 'utf8'),
      /cp --quiet .*20261001\.gz archive\/causedeck-logs-archive\/docker\/vps1\/2026-10-01\//,
    );
    assert.ok(!existsSync(path.join(container, 'abcdef0123456789-json.log-20261001.gz')));
    assert.ok(
      existsSync(path.join(container, 'abcdef0123456789-json.log')),
      'live log is never touched',
    );
  });

  it('keeps the local file when the upload fails', () => {
    const logs = path.join(tmp, 'containers2');
    const container = path.join(logs, 'c1');
    mkdirSync(container, { recursive: true });
    const file = path.join(container, 'c1-json.log-20261002.gz');
    writeFileSync(file, 'x');
    const mc = path.join(tmp, 'mc-fail');
    writeFileSync(mc, '#!/bin/sh\nexit 1\n');
    chmodSync(mc, 0o755);
    const result = run([], { DOCKER_LOG_DIR: logs, MC_BIN: mc });
    assert.notEqual(result.status, 0);
    assert.ok(existsSync(file));
  });
});

describe('archive lifecycle and compose', () => {
  const lifecycle = JSON.parse(readFileSync(path.join(dir, 'archive-lifecycle.json'), 'utf8')) as {
    region: string;
    objectLock: { mode: string; days: number };
    Rules: { Expiration: { Days: number } }[];
  };

  it('locks 180 days in COMPLIANCE mode in ap-south-2', () => {
    assert.equal(lifecycle.region, 'ap-south-2');
    assert.equal(lifecycle.objectLock.mode, 'COMPLIANCE');
    assert.ok(lifecycle.objectLock.days >= 180);
    for (const rule of lifecycle.Rules) assert.ok(rule.Expiration.Days >= 180);
  });

  it('rotates daily with gzip', () => {
    const conf = readFileSync(path.join(dir, 'logrotate-docker.conf'), 'utf8');
    assert.match(conf, /^\s*daily$/m);
    assert.match(conf, /^\s*compress$/m);
    assert.match(conf, /^\s*dateext$/m);
  });
});
