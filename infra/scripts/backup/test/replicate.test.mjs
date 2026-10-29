// Stubbed-shell tests for the off-host replica (#884): minio-replicate.sh against an S3 endpoint
// (a fake `mc` on PATH records its calls) and restore-drill.sh --dry-run against the replica.
// No Docker, network or credentials: every value below is a placeholder.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const infra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(path.join(infra, rel), 'utf8');
const hasJq = spawnSync('jq', ['--version']).status === 0;

const stubDir = mkdtempSync(path.join(tmpdir(), 'replicate-'));
const log = path.join(stubDir, 'mc.log');
writeFileSync(
  path.join(stubDir, 'mc'),
  `#!/bin/sh\necho "$*" >>"${log}"\ncat >/dev/null 2>&1 || true\n`,
);
chmodSync(path.join(stubDir, 'mc'), 0o755);

const baseEnv = {
  PATH: `${stubDir}:${process.env.PATH}`,
  MC_CONFIG_DIR: stubDir,
  PRIMARY_ENDPOINT: 'http://minio:9000',
  PRIMARY_ACCESS_KEY: 'placeholder-primary',
  PRIMARY_SECRET_KEY: 'placeholder-primary-secret',
  REPLICA_ACCESS_KEY: 'placeholder-replica',
  REPLICA_SECRET_KEY: 'placeholder-replica-secret',
  ALLOW_LOCAL_ENDPOINTS: '1',
  REPLICATION_CONFIG: path.join(infra, 'docker/minio/replication.json'),
};
const replicate = (env) => {
  writeFileSync(log, '');
  const r = spawnSync('sh', [path.join(infra, 'scripts/backup/minio-replicate.sh')], {
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
  });
  return { ...r, calls: readFileSync(log, 'utf8') };
};
const s3 = {
  REPLICA_ENDPOINT: 'https://s3.ap-south-2.amazonaws.com',
  REPLICA_REGION: 'ap-south-2',
  REPLICA_BUCKET: 'causedeck-replica-placeholder',
};

describe('minio-replicate.sh to S3 ap-south-2', () => {
  it('replicates into the Hyderabad bucket under per-bucket prefixes, SSE-S3 on', () => {
    const r = replicate(s3);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ok canary/);
    assert.match(r.calls, /alias set replica https:\/\/s3\.ap-south-2\.amazonaws\.com/);
    assert.match(r.calls, /encrypt set sse-s3 replica\/causedeck-replica-placeholder/);
    assert.match(
      r.calls,
      /mirror .*primary\/causedeck-wal replica\/causedeck-replica-placeholder\/causedeck-wal/,
    );
    assert.doesNotMatch(r.calls, /--remove/);
    assert.doesNotMatch(r.calls, /mb /, 'the scoped IAM user never creates buckets');
  });

  it('supports SSE-KMS and refuses it without a key id', () => {
    const ok = replicate({
      ...s3,
      REPLICA_SSE: 'sse-kms',
      REPLICA_KMS_KEY_ID: 'alias/placeholder',
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.calls, /encrypt set sse-kms alias\/placeholder replica\//);
    assert.notEqual(replicate({ ...s3, REPLICA_SSE: 'sse-kms' }).status, 0);
    assert.notEqual(replicate({ ...s3, REPLICA_SSE: 'none' }).status, 0);
  });

  it('refuses any region outside ap-south-1 and ap-south-2', () => {
    for (const region of ['us-east-1', 'ap-southeast-1', 'eu-west-1']) {
      const r = replicate({ ...s3, REPLICA_REGION: region });
      assert.notEqual(r.status, 0, region);
      assert.match(r.stderr, /outside India/);
      assert.equal(r.calls, '', 'nothing may run against the replica');
    }
    const host = replicate({ ...s3, REPLICA_ENDPOINT: 'https://s3.us-east-1.amazonaws.com' });
    assert.notEqual(host.status, 0);
    assert.equal(host.calls, '');
  });

  it('refuses an endpoint whose region differs from REPLICA_REGION', () => {
    const r = replicate({ ...s3, REPLICA_ENDPOINT: 'https://s3.ap-south-1.amazonaws.com' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not in REPLICA_REGION/);
  });

  it('defaults to ap-south-2 and keeps the WAL watch', () => {
    const r = replicate({ ...s3, REPLICA_REGION: '', REPLICATE_WATCH: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.calls,
      /mirror --watch --preserve primary\/causedeck-wal replica\/causedeck-replica-placeholder\/causedeck-wal/,
    );
  });

  it('still mirrors to a same-named bucket on a MinIO replica without REPLICA_BUCKET', () => {
    const r = replicate({
      REPLICA_ENDPOINT: 'http://minio-replica:9000',
      REPLICA_REGION: 'ap-south-1',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.calls, /mirror .*primary\/causedeck-wal replica\/causedeck-wal/);
  });
});

describe('encryption at rest and lifecycle', () => {
  it('WAL is libsodium-encrypted before upload and the replica only copies it', () => {
    const compose = read('docker/compose.prod.yml');
    assert.match(compose, /WALG_LIBSODIUM_KEY_PATH: \/run\/secrets\/walg_key/);
    assert.match(compose, /REPLICA_SSE: \$\{REPLICA_SSE:-sse-s3\}/);
    assert.match(compose, /REPLICA_REGION: \$\{REPLICA_REGION:-ap-south-2\}/);
    assert.match(compose, /REPLICA_BUCKET:/);
    assert.doesNotMatch(compose, /AWS_DEFAULT_REGION/);
  });

  it('bucket lifecycle is 30 days for WAL and base backups, 180 days for logs', () => {
    const { Rules } = JSON.parse(read('docker/minio/replica-lifecycle.json'));
    const byId = Object.fromEntries(Rules.map((r) => [r.ID, r]));
    assert.equal(byId['wal-and-base-backups-30d'].Expiration.Days, 30);
    assert.equal(byId['logs-180d'].Expiration.Days, 180);
    const runbook = read('runbooks/dr-hyderabad.md');
    assert.match(runbook, /30 days/);
    assert.match(runbook, /180 days/);
  });

  it('env examples hold no real credentials', () => {
    for (const f of ['docker/env/prod.env.example', 'docker/env/staging.env.example']) {
      const t = read(f);
      assert.match(t, /^REPLICA_ACCESS_KEY=$/m);
      assert.match(t, /^REPLICA_SECRET_KEY=$/m);
      assert.doesNotMatch(t, /AKIA[0-9A-Z]{12,}/);
    }
  });
});

describe(
  'restore drill from the Hyderabad replica (dry run)',
  { skip: !hasJq && 'jq missing' },
  () => {
    const key = path.join(stubDir, 'walg.key');
    writeFileSync(key, '0'.repeat(64));
    const drill = (env) => {
      const report = path.join(stubDir, `report-${Math.random()}.json`);
      const r = spawnSync(
        'bash',
        [path.join(infra, 'scripts/restore/restore-drill.sh'), '--dry-run', '--report', report],
        {
          env: { PATH: process.env.PATH, WALG_LIBSODIUM_KEY_PATH: key, ...env },
          encoding: 'utf8',
        },
      );
      return { ...r, report: () => JSON.parse(readFileSync(report, 'utf8')) };
    };
    const replica = {
      WALG_S3_PREFIX: 's3://causedeck-replica-placeholder/causedeck-wal',
      AWS_ENDPOINT: 'https://s3.ap-south-2.amazonaws.com',
      AWS_REGION: 'ap-south-2',
    };

    it('passes against the replica without Docker or credentials', () => {
      const r = drill(replica);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.report().ok, true);
    });

    it('fails when pointed outside India', () => {
      const r = drill({ ...replica, AWS_ENDPOINT: '', AWS_REGION: 'us-east-1' });
      assert.equal(r.status, 1);
      assert.equal(r.report().ok, false);
    });

    it('the workflow offers source=replica and a dry run', () => {
      const w = read('../.github/workflows/restore-drill.yml');
      assert.match(w, /source:[\s\S]*options: \[primary, replica\]/);
      assert.match(w, /STAGING_REPLICA_WALG_S3_PREFIX/);
      assert.match(w, /--dry-run/);
    });
  },
);
