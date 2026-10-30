// Unit tests for the backup, replication and restore scripts (#101): `node --test infra/scripts/`.
// No Docker or storage needed: the India guard, the restore refusals, retention arithmetic and
// static checks of the scripts. The backup -> PITR -> restore run is pitr-integration.sh (CI only).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const infra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const guard = path.join(infra, 'scripts/backup/lib/india-guard.sh');
const read = (rel) => readFileSync(path.join(infra, rel), 'utf8');

const sh = (script, env = {}) =>
  spawnSync('sh', ['-c', script], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
const guardCheck = (args, env) => sh(`sh ${guard} ${args}`, env).status;

describe('india-guard.sh', () => {
  it('accepts India endpoints and regions', () => {
    assert.equal(guardCheck('https://s3.ap-south-1.amazonaws.com'), 0);
    assert.equal(guardCheck('https://objects.ap-south-2.amazonaws.com/x'), 0);
    assert.equal(guardCheck('https://bucket.objectstore.e2enetworks.net'), 0);
    assert.equal(guardCheck("'' ap-south-1"), 0);
  });

  it('rejects non-India endpoints, regions, plain http and look-alike hosts', () => {
    assert.notEqual(guardCheck('https://s3.us-east-1.amazonaws.com'), 0);
    assert.notEqual(guardCheck("'' us-east-1"), 0);
    assert.notEqual(guardCheck('http://s3.ap-south-1.amazonaws.com'), 0);
    assert.notEqual(guardCheck('https://ap-south-1.amazonaws.com.evil.example'), 0);
    assert.notEqual(guardCheck('ftp://s3.ap-south-1.amazonaws.com'), 0);
  });

  it('allows local MinIO hosts only with ALLOW_LOCAL_ENDPOINTS=1', () => {
    assert.notEqual(guardCheck('http://minio:9000'), 0);
    assert.equal(guardCheck('http://minio:9000', { ALLOW_LOCAL_ENDPOINTS: '1' }), 0);
    assert.notEqual(guardCheck('http://evil.example:9000', { ALLOW_LOCAL_ENDPOINTS: '1' }), 0);
  });

  it('honours INDIA_ENDPOINT_ALLOWLIST', () => {
    assert.equal(
      guardCheck('https://store.example.in', { INDIA_ENDPOINT_ALLOWLIST: '.example.in' }),
      0,
    );
    assert.notEqual(
      guardCheck('https://s3.ap-south-1.amazonaws.com', {
        INDIA_ENDPOINT_ALLOWLIST: '.example.in',
      }),
      0,
    );
  });
});

describe('weekly_expired (retention arithmetic)', () => {
  const list = JSON.stringify([
    { backup_name: 'base_old', start_time: '2026-01-01T00:00:00Z', is_permanent: true },
    { backup_name: 'base_new', start_time: '2026-10-20T00:00:00Z', is_permanent: true },
    { backup_name: 'base_daily', start_time: '2026-01-01T00:00:00Z', is_permanent: false },
  ]);
  it('lists only permanent backups older than the cutoff', () => {
    const cutoff = Date.parse('2026-09-01T00:00:00Z') / 1000;
    const r = sh(`. ${guard}; weekly_expired ${cutoff}`, {});
    assert.equal(r.status, 0);
    const piped = spawnSync(
      'sh',
      ['-c', `. ${guard}; printf '%s' "$LIST" | weekly_expired ${cutoff}`],
      {
        env: { PATH: process.env.PATH, LIST: list },
        encoding: 'utf8',
      },
    );
    assert.equal(piped.stdout.trim(), 'base_old');
  });
});

describe('restore-prod.sh refusals (R10)', () => {
  const script = path.join(infra, 'scripts/restore/restore-prod.sh');
  const run = (args) =>
    spawnSync('bash', [script, ...args], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      input: '',
    });

  it('refuses without --i-understand', () => {
    const r = run(['--target-volume', 'fresh']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--i-understand/);
  });
  it('refuses without a target volume', () => {
    const r = run(['--i-understand']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--target-volume/);
  });
  it('refuses the production data volume', () => {
    for (const v of ['causedeck_pgdata', 'other_pgdata']) {
      const r = run(['--i-understand', '--target-volume', v]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /fresh volume/);
    }
  });
  it('refuses without the key file', () => {
    const r = run(['--i-understand', '--target-volume', 'restore_1']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /WALG_LIBSODIUM_KEY_PATH/);
  });
  it('rejects a bad target time', () => {
    const r = run(['--i-understand', '--target-volume', 'restore_1', '--target-time', "x'; drop"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--target-time/);
  });
});

describe('script contracts', () => {
  it('basebackup verifies, marks weekly and applies configurable retention', () => {
    const s = read('scripts/backup/walg-basebackup.sh');
    assert.match(s, /wal-g backup-push/);
    assert.match(s, /wal-g backup-list/);
    assert.match(s, /wal-g backup-mark/);
    assert.match(s, /wal-g delete retain FULL "\$RETAIN_DAILY"/);
    assert.match(s, /BACKUP_RETAIN_DAILY:-14/);
    assert.match(s, /BACKUP_RETAIN_WEEKLY:-8/);
    assert.match(s, /assert_india_target/);
    assert.match(s, /WALG_LIBSODIUM_KEY_PATH/);
  });
  it('WAL check alerts above the 5 minute SLO', () => {
    const s = read('scripts/backup/walg-wal-push-check.sh');
    assert.match(s, /WAL_MAX_AGE_SECONDS:-300/);
    assert.match(s, /walg_last_archive_age_seconds/);
  });
  it('replication never propagates deletes and uses a canary', () => {
    const s = read('scripts/backup/minio-replicate.sh');
    assert.doesNotMatch(s.replace(/^\s*#.*$/gm, ''), /--remove/);
    assert.match(s, /canary/);
    assert.match(s, /assert_india_endpoint/);
    const cfg = JSON.parse(read('docker/minio/replication.json'));
    assert.equal(cfg.versioning, true);
    assert.equal(cfg.propagateDeletes, false);
    assert.ok(cfg.maxLagHours <= 24);
  });
  it('drill runs verify.sql, measures RPO/RTO against the PRD targets and uses a fresh volume', () => {
    const s = read('scripts/restore/restore-drill.sh');
    assert.match(s, /RPO_TARGET=900/);
    assert.match(s, /RTO_TARGET=14400/);
    assert.match(s, /docker volume create/);
    assert.match(s, /assert_india_target/);
    assert.doesNotMatch(s, /-v "\$\{?PROD/);
    const v = read('scripts/restore/verify.sql');
    for (const name of ['amcheck', 'row_counts', 'rls_enabled', 'cross_tenant', 'crypto_erase']) {
      assert.match(v, new RegExp(`'${name}'`));
    }
  });
  it('encryption key is never an inline value', () => {
    for (const f of ['docker/postgres/wal-g.env.example', 'docker/env/prod.env.example']) {
      assert.doesNotMatch(read(f), /^WALG_LIBSODIUM_KEY=/m);
    }
    assert.match(read('docker/postgres/wal-g.env.example'), /^WALG_LIBSODIUM_KEY_PATH=/m);
  });
});
