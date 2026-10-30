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

// migrate-compose-to-dedicated-postgres.sh (#887): a stub psql answers from per-side fixture files,
// so row counts, RLS state, wal_level, replication lag and sequences can differ between the sides.
describe('migrate-compose-to-dedicated-postgres.sh', () => {
  const script = path.join(dir, 'migrate-compose-to-dedicated-postgres.sh');
  const SOURCE = 'postgres://u:p@source:5432/app';
  const TARGET = 'postgres://u:p@db-primary.example:5432/app?sslmode=verify-full';
  const base = {
    SOURCE_URL: SOURCE,
    TARGET_URL: TARGET,
    TARGET_ALLOWED_HOSTS: 'db-primary.example',
  };

  let stubs;
  let calls;
  const fixture = (side, name, text) => writeFileSync(path.join(stubs, `${side}.${name}`), text);
  const same = (name, text) => {
    fixture('src', name, text);
    fixture('dst', name, text);
  };
  const reset = () => {
    for (const side of ['src', 'dst']) {
      fixture(side, 'counts', 'matters=12\nusers=3\n');
      fixture(side, 'rls', 'matters:true:true:4\nusers:true:true:2\n');
      fixture(side, 'seq', 'public.matters_id_seq 41\npublic.users_id_seq 7\n');
    }
    fixture('src', 'wal', 'logical\n');
    fixture('src', 'lag', '0\n');
  };

  before(() => {
    stubs = mkdtempSync(path.join(tmpdir(), 'dedicated-stubs-'));
    calls = path.join(stubs, 'calls.log');
    writeFileSync(
      path.join(stubs, 'psql'),
      `#!/bin/sh
url=$1
echo "psql $*" >> "${calls}"
case "$url" in *source*) side=src ;; *) side=dst ;; esac
case "$*" in
  *pg_policy*) f=rls ;;
  *query_to_xml*) f=counts ;;
  *pg_sequences*) f=seq ;;
  *wal_level*) f=wal ;;
  *confirmed_flush_lsn*) f=lag ;;
  *current_database*) echo causedeck; exit 0 ;;
  *) exit 0 ;;
esac
cat "${stubs}/$side.$f" 2>/dev/null || true
`,
    );
    chmodSync(path.join(stubs, 'psql'), 0o755);
    writeFileSync(path.join(stubs, 'sleep'), '#!/bin/sh\nexit 0\n');
    chmodSync(path.join(stubs, 'sleep'), 0o755);
  });
  after(() => rmSync(stubs, { recursive: true, force: true }));

  const exec = (args, env = base, tweak = () => {}) => {
    reset();
    tweak();
    if (existsSync(calls)) rmSync(calls);
    const r = spawnSync('sh', [script, ...args], {
      env: { PATH: `${stubs}:${process.env.PATH}`, TMPDIR: stubs, ...env },
      encoding: 'utf8',
    });
    return { ...r, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
  };

  it('is a dry run by default and connects to nothing', () => {
    const r = exec([], {});
    assert.equal(r.status, 0);
    assert.match(r.stdout, /dry run/);
    assert.match(r.stdout, /promote:/);
    assert.equal(r.calls, '');
  });

  it('refuses a target that is not a listed dedicated node, or is not encrypted', () => {
    const unlisted = exec(['--execute', 'verify'], {
      ...base,
      TARGET_ALLOWED_HOSTS: 'other.example',
    });
    assert.notEqual(unlisted.status, 0);
    assert.match(unlisted.stderr, /not in TARGET_ALLOWED_HOSTS/);
    const none = exec(['--execute', 'verify'], { SOURCE_URL: SOURCE, TARGET_URL: TARGET });
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /TARGET_ALLOWED_HOSTS/);
    const plain = exec(['--execute', 'verify'], {
      ...base,
      TARGET_URL: 'postgres://u:p@db-primary.example:5432/app',
    });
    assert.notEqual(plain.status, 0);
    assert.match(plain.stderr, /sslmode/);
    assert.equal(`${unlisted.calls}${none.calls}${plain.calls}`, '');
  });

  it('allows a local scratch target only with ALLOW_LOCAL_TARGET=1', () => {
    const local = { SOURCE_URL: SOURCE, TARGET_URL: 'postgres://u:p@localhost:5432/app' };
    const denied = exec(['--execute', 'verify'], local);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /ALLOW_LOCAL_TARGET/);
    assert.equal(exec(['--execute', 'verify'], { ...local, ALLOW_LOCAL_TARGET: '1' }).status, 0);
  });

  it('setup needs wal_level = logical on the source and creates nothing otherwise', () => {
    const ok = exec(['--execute', 'setup']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.calls, /create publication causedeck_cutover for all tables/);
    assert.match(ok.calls, /create subscription causedeck_cutover connection/);
    const r = exec(['--execute', 'setup'], base, () => fixture('src', 'wal', 'replica\n'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not logical/);
    assert.doesNotMatch(r.calls, /create publication|create subscription/);
  });

  it('verify passes when row counts and RLS state match on both sides', () => {
    const r = exec(['--execute', 'verify']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 tables, row counts and RLS state match/);
  });

  const verifyWith = (side, name, text) =>
    exec(['--execute', 'verify'], base, () => fixture(side, name, text));

  it('verify fails when a row count differs', () => {
    const r = verifyWith('dst', 'counts', 'matters=11\nusers=3\n');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /row counts differ/);
  });

  it('verify fails when RLS is not forced, or a policy is missing, on the target', () => {
    const forced = verifyWith('dst', 'rls', 'matters:true:false:4\nusers:true:true:2\n');
    assert.notEqual(forced.status, 0);
    assert.match(forced.stderr, /RLS state/);
    const policy = verifyWith('dst', 'rls', 'matters:true:true:3\nusers:true:true:2\n');
    assert.notEqual(policy.status, 0);
    assert.match(policy.stderr, /RLS state/);
  });

  it('cutover sets the source read-only, verifies, and reports the downtime', () => {
    const r = exec(['--execute', 'cutover']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.calls, /set default_transaction_read_only = on/);
    assert.match(r.stdout, /downtime so far \d+s/);
  });

  it('cutover reopens the source for writes when verification fails', () => {
    const r = exec(['--execute', 'cutover'], base, () =>
      fixture('dst', 'counts', 'matters=11\nusers=3\n'),
    );
    assert.notEqual(r.status, 0);
    assert.match(r.calls, /reset default_transaction_read_only/);
  });

  it('promote copies the sequences and drops the subscription', () => {
    const r = exec(['--execute', 'promote']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.calls, /select setval\('public\.matters_id_seq', 41\)/);
    assert.match(r.calls, /select setval\('public\.users_id_seq', 7\)/);
    assert.match(r.calls, /drop subscription causedeck_cutover/);
    assert.match(r.stdout, /copied 2 sequence value\(s\)/);
    assert.doesNotMatch(r.calls, /reset default_transaction_read_only/);
  });

  it('promote refuses while the subscription still lags, and touches nothing', () => {
    const r = exec(['--execute', 'promote'], base, () => fixture('src', 'lag', '4096\n'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not caught up/);
    assert.doesNotMatch(r.calls, /setval|drop subscription/);
  });

  it('rollback reopens the source and drops the subscription', () => {
    const r = exec(['--execute', 'rollback']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.calls, /reset default_transaction_read_only/);
    assert.match(r.calls, /drop subscription causedeck_cutover/);
  });
});
