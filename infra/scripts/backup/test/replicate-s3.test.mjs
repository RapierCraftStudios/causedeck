// Stubbed tests for S3 (Hyderabad) replication and the replica restore drill (#884):
// `node --test infra/scripts/backup/test/replicate-s3.test.mjs`. `mc` is a PATH stub that records
// its arguments; no Docker or storage is touched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const infra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(path.join(infra, rel), 'utf8');

const S3_ENV = {
  PRIMARY_ENDPOINT: 'http://minio:9000',
  PRIMARY_ACCESS_KEY: 'p',
  PRIMARY_SECRET_KEY: 'p-secret',
  REPLICA_ENDPOINT: 'https://s3.ap-south-2.amazonaws.com',
  REPLICA_REGION: 'ap-south-2',
  REPLICA_BUCKET: 'cd-replica',
  REPLICA_ACCESS_KEY: 'r',
  REPLICA_SECRET_KEY: 'r-secret',
  ALLOW_LOCAL_ENDPOINTS: '1',
  S3_BUCKET: 'causedeck-app',
};

function replicate(extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'replicate-s3-'));
  const log = path.join(dir, 'mc.log');
  writeFileSync(log, '');
  const stub = path.join(dir, 'mc');
  writeFileSync(
    stub,
    `#!/bin/sh\necho "$*" >> "${log}"\n[ "$1" = pipe ] && cat >/dev/null\nexit 0\n`,
  );
  chmodSync(stub, 0o755);
  const r = spawnSync('sh', [path.join(infra, 'scripts/backup/minio-replicate.sh')], {
    env: { PATH: `${dir}:${process.env.PATH}`, MC_CONFIG_DIR: dir, ...S3_ENV, ...extra },
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr, calls: readFileSync(log, 'utf8').split('\n') };
}

describe('minio-replicate.sh S3 mode', () => {
  it('replicates to the Hyderabad bucket with SSE-S3 under per-bucket prefixes', () => {
    const r = replicate();
    assert.equal(r.status, 0, r.stderr);
    const mirrors = r.calls.filter((c) => c.startsWith('mirror'));
    assert.equal(mirrors.length, 3);
    for (const m of mirrors) assert.match(m, /--enc-s3=replica\/cd-replica\/causedeck-/);
    assert.ok(
      mirrors.some((m) => m.endsWith('primary/causedeck-wal replica/cd-replica/causedeck-wal')),
    );
    assert.ok(!r.calls.some((c) => c.startsWith('mb')), 'must not create the pre-made bucket');
    assert.ok(!r.calls.some((c) => /--remove/.test(c)));
    assert.ok(
      r.calls.some((c) =>
        c.startsWith('stat replica/cd-replica/causedeck-ops/replication-canary/'),
      ),
    );
  });

  it('uses SSE-KMS when a key is set', () => {
    const r = replicate({ REPLICA_SSE_KMS_KEY: 'arn:aws:kms:ap-south-2:1:key/k' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
      r.calls.some((c) => c.includes('--enc-kms=replica/cd-replica/causedeck-wal=arn:aws:kms')),
    );
    assert.ok(!r.calls.some((c) => c.includes('--enc-s3')));
  });

  it('keeps the WAL watch, encrypted', () => {
    const r = replicate({ REPLICATE_WATCH: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
      r.calls.some(
        (c) =>
          c.startsWith('mirror --watch') && c.includes('--enc-s3=replica/cd-replica/causedeck-wal'),
      ),
    );
  });

  it('refuses regions and endpoints outside India', () => {
    for (const extra of [
      { REPLICA_REGION: 'us-east-1' },
      { REPLICA_REGION: '' },
      { REPLICA_ENDPOINT: 'https://s3.us-east-1.amazonaws.com', REPLICA_REGION: 'ap-south-2' },
    ]) {
      const r = replicate(extra);
      assert.notEqual(r.status, 0);
      assert.ok(!r.calls.some((c) => c.startsWith('mirror')));
    }
    assert.equal(replicate({ REPLICA_REGION: 'ap-south-1' }).status, 0);
  });

  it('local MinIO mode is unchanged', () => {
    const r = replicate({
      REPLICA_BUCKET: '',
      REPLICA_REGION: '',
      REPLICA_ENDPOINT: 'http://minio-replica:9000',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
      r.calls.some((c) => c.startsWith('mb --ignore-existing --with-lock replica/causedeck-wal')),
    );
    assert.ok(
      r.calls.some(
        (c) => c === 'mirror --preserve --overwrite primary/causedeck-wal replica/causedeck-wal',
      ),
    );
  });
});

describe('encryption contracts', () => {
  it('WAL stays libsodium-encrypted and the replicator never decrypts', () => {
    assert.match(
      read('docker/compose.prod.yml'),
      /WALG_LIBSODIUM_KEY_PATH: \/run\/secrets\/walg_key/,
    );
    assert.match(read('docker/postgres/wal-g.env.example'), /^WALG_LIBSODIUM_KEY_PATH=/m);
    assert.doesNotMatch(read('scripts/backup/minio-replicate.sh'), /LIBSODIUM|wal-g/);
  });
  it('compose passes the replica settings with an India default and no foreign region', () => {
    const c = read('docker/compose.prod.yml');
    assert.match(c, /REPLICA_REGION: \$\{REPLICA_REGION:-ap-south-2\}/);
    assert.match(c, /REPLICA_BUCKET:/);
    assert.match(c, /REPLICA_SSE_KMS_KEY:/);
    assert.doesNotMatch(c, /(us|eu|ap-southeast|ap-northeast)-[a-z]+-\d/);
  });
});

describe('restore drill from the replica', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'drill-s3-'));
  const key = path.join(dir, 'walg.key');
  writeFileSync(key, 'stub');
  const drill = (extra = {}) => {
    const report = path.join(dir, 'report.json');
    const r = spawnSync(
      'bash',
      [path.join(infra, 'scripts/restore/restore-drill.sh'), '--dry-run', '--report', report],
      {
        // No docker on PATH shims: a dry run must not need it.
        env: {
          PATH: process.env.PATH,
          DRILL_IMAGE: 'stub',
          WALG_S3_PREFIX: 's3://cd-replica/causedeck-wal',
          AWS_ENDPOINT: 'https://s3.ap-south-2.amazonaws.com',
          AWS_REGION: 'ap-south-2',
          WALG_LIBSODIUM_KEY_PATH: key,
          ...extra,
        },
        encoding: 'utf8',
      },
    );
    return { status: r.status, report };
  };
  it('dry run against the Hyderabad replica passes', () => {
    const r = drill();
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(readFileSync(r.report, 'utf8')).ok, true);
  });
  it('dry run refuses a non-India region and a non-s3 prefix', () => {
    assert.equal(drill({ AWS_ENDPOINT: '', AWS_REGION: 'us-east-1' }).status, 1);
    assert.equal(drill({ WALG_S3_PREFIX: 'file:///x' }).status, 1);
  });
  it('workflow offers the replica source and a stubbed dry run', () => {
    const w = read('../.github/workflows/restore-drill.yml');
    assert.match(w, /options: \[primary, replica\]/);
    assert.match(w, /restore-drill\.sh --dry-run/);
  });
});

describe('runbooks name the lifecycle', () => {
  it('30 days for WAL and base backups, 180 days for logs', () => {
    for (const f of ['runbooks/dr-hyderabad.md', 'runbooks/restore.md']) {
      const t = read(f).replace(/\s+/g, ' ');
      assert.match(t, /30 days/);
      assert.match(t, /180 days/);
      assert.match(t, /#886/);
    }
  });
});
