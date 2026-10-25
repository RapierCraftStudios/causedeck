// Tests for the Stage B migration scripts (#106): `node --test infra/scripts/stage-b/test/`.
// psql and rclone are stubs on PATH that log their arguments, so no database or storage is used.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = path.join(dir, 'migrate-postgres-to-rds.sh');
const s3 = path.join(dir, 'migrate-minio-to-s3.sh');

let bin;
let log;
before(() => {
  bin = mkdtempSync(path.join(tmpdir(), 'stage-b-stubs-'));
  log = path.join(bin, 'calls.log');
  for (const name of ['psql', 'rclone']) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
});
after(() => rmSync(bin, { recursive: true, force: true }));

const run = (script, args, env = {}) => {
  if (existsSync(log)) rmSync(log);
  const r = spawnSync('sh', [script, ...args], {
    env: { PATH: `${bin}:${process.env.PATH}`, TMPDIR: bin, ...env },
    encoding: 'utf8',
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  return { ...r, calls };
};

const RDS = 'postgres://u:p@db.abc.ap-south-1.rds.amazonaws.com:5432/app';
const urls = { SOURCE_URL: 'postgres://u:p@postgres:5432/app', TARGET_URL: RDS };

describe('migrate-postgres-to-rds.sh', () => {
  it('is a dry run by default and connects to nothing', () => {
    const r = run(pg, []);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /dry run/);
    assert.match(r.stdout, /CREATE PUBLICATION/);
    assert.equal(r.calls, '');
  });

  it('refuses --execute without a step or URLs', () => {
    assert.notEqual(run(pg, ['--execute']).status, 0);
    assert.notEqual(run(pg, ['--execute', 'setup']).status, 0);
    assert.equal(run(pg, ['--execute', 'setup']).calls, '');
  });

  it('refuses a target outside India or a non-RDS target', () => {
    for (const host of ['db.abc.us-east-1.rds.amazonaws.com', 'db.example.com']) {
      const r = run(pg, ['--execute', 'setup'], {
        ...urls,
        TARGET_URL: `postgres://u:p@${host}:5432/app`,
      });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /not an RDS endpoint/);
      assert.equal(r.calls, '');
    }
  });

  it('allows a local scratch target only with ALLOW_LOCAL_TARGET=1', () => {
    const local = { ...urls, TARGET_URL: 'postgres://u:p@localhost:5432/app' };
    const denied = run(pg, ['--execute', 'setup'], local);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /ALLOW_LOCAL_TARGET/);
    assert.equal(run(pg, ['--execute', 'setup'], { ...local, ALLOW_LOCAL_TARGET: '1' }).status, 0);
  });

  it('setup creates the publication and subscription through psql', () => {
    const r = run(pg, ['--execute', 'setup'], urls);
    assert.equal(r.status, 0);
    assert.match(r.calls, /create publication causedeck_cutover/);
    assert.match(r.calls, /create subscription causedeck_cutover/);
  });

  it('verify passes when the stubbed databases agree', () => {
    const r = run(pg, ['--execute', 'verify'], urls);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /match/);
  });
});

describe('migrate-minio-to-s3.sh', () => {
  const env = {
    MINIO_ENDPOINT: 'http://minio:9000',
    MINIO_BUCKET: 'causedeck',
    S3_BUCKET: 'causedeck-stage-b',
    ALLOW_LOCAL_ENDPOINTS: '1',
  };

  it('dry-runs by default with --checksum', () => {
    const r = run(s3, [], env);
    assert.equal(r.status, 0);
    assert.match(r.calls, /rclone sync src:causedeck dst:causedeck-stage-b --checksum --dry-run/);
  });

  it('--execute syncs and then verifies with rclone check', () => {
    const r = run(s3, ['--execute'], env);
    assert.equal(r.status, 0);
    assert.match(r.calls, /rclone sync src:causedeck dst:causedeck-stage-b --checksum\n/);
    assert.match(r.calls, /rclone check .* --one-way --checksum/);
  });

  it('--verify never syncs', () => {
    const r = run(s3, ['--verify'], env);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.calls, /rclone sync/);
  });

  it('rejects a non-India region and a non-India MinIO endpoint', () => {
    const region = run(s3, [], { ...env, S3_REGION: 'us-east-1' });
    assert.notEqual(region.status, 0);
    assert.equal(region.calls, '');
    const endpoint = run(s3, [], { ...env, ALLOW_LOCAL_ENDPOINTS: '0' });
    assert.notEqual(endpoint.status, 0);
    assert.equal(endpoint.calls, '');
  });
});
