// Tests for the Stage B database compose (#887): `node --test infra/scripts/compose-db.test.mjs`.
// Plain-text checks on compose.db.yml and its helpers (like compose-prod.test.mjs), plus a render
// through `docker compose config` when the Compose plugin exists (it needs no daemon or network).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const docker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docker');
const read = (...p) => readFileSync(path.join(docker, ...p), 'utf8');
const compose = read('compose.db.yml');

const servicesText = compose.slice(compose.indexOf('\nservices:\n'));
const services = {};
{
  let current = null;
  for (const line of servicesText.split('\n').slice(2)) {
    const head = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (head) {
      current = head[1];
      services[current] = '';
    } else if (current) services[current] += `${line}\n`;
  }
}
const names = Object.keys(services);

describe('compose.db.yml topology', () => {
  it('has a primary and a replica, each with its own PgBouncer, in separate profiles', () => {
    assert.deepEqual(names.sort(), [
      'pgbouncer-primary',
      'pgbouncer-replica',
      'postgres-primary',
      'postgres-replica',
    ]);
    for (const n of ['postgres-primary', 'pgbouncer-primary'])
      assert.match(services[n], /profiles: \[primary\]/);
    for (const n of ['postgres-replica', 'pgbouncer-replica'])
      assert.match(services[n], /profiles: \[replica\]/);
  });

  it('primary: archives WAL through WAL-G to the Hyderabad bucket', () => {
    const p = services['postgres-primary'];
    assert.match(p, /WALG_S3_PREFIX: \$\{WALG_S3_PREFIX:\?/);
    assert.match(p, /AWS_REGION: \$\{WALG_AWS_REGION:-ap-south-2\}/);
    assert.match(p, /WALG_LIBSODIUM_KEY_PATH: \/run\/secrets\/walg_key/);
    assert.match(p, /AWS_ACCESS_KEY_ID: \$\{WALG_ARCHIVE_ACCESS_KEY:\?/);
    const conf = read('postgres', 'postgresql.conf');
    assert.match(conf, /^archive_mode = on$/m);
    assert.match(conf, /^archive_command = 'wal-g wal-push %p'$/m);
    assert.match(conf, /^wal_level = replica$/m);
    assert.match(p, /-c\n\s+- config_file=\/etc\/postgresql\/postgresql\.conf/);
    assert.doesNotMatch(p, /archive_mode=off|primary_conninfo/);
  });

  it('primary: allows replication connections and keeps WAL for the replica slot', () => {
    const p = services['postgres-primary'];
    assert.match(p, /max_wal_senders=\d+/);
    assert.match(p, /max_replication_slots=\d+/);
    assert.match(p, /wal_keep_size=/);
    assert.match(p, /REPLICATION_PASSWORD: \$\{REPLICATION_PASSWORD:\?/);
  });

  it('replica: streams from the primary with primary_conninfo and a physical slot', () => {
    const r = services['postgres-replica'];
    assert.match(
      r,
      /- primary_conninfo=host=\$\{PRIMARY_HOST:\?[^}]+\} port=5432 user=replicator sslmode=require/,
    );
    assert.match(r, /- primary_slot_name=replica1/);
    assert.match(r, /entrypoint: \['sh', '\/usr\/local\/bin\/replica-entrypoint\.sh'\]/);
  });

  it('replica: is read-only and never archives', () => {
    const r = services['postgres-replica'];
    assert.match(r, /- hot_standby=on/);
    assert.match(r, /- default_transaction_read_only=on/);
    assert.doesNotMatch(r, /WALG_|archive_mode=always|archive_command/);
    assert.doesNotMatch(r, /POSTGRES_PASSWORD/, 'a standby is never initdb-ed');
  });

  it('PgBouncer pools per transaction with SCRAM and TLS required', () => {
    for (const n of ['pgbouncer-primary', 'pgbouncer-replica']) {
      const b = services[n];
      assert.match(b, /POOL_MODE: transaction/);
      assert.match(b, /AUTH_TYPE: scram-sha-256/);
      assert.match(b, /CLIENT_TLS_SSLMODE: require/);
      assert.match(b, /SERVER_TLS_SSLMODE: require/);
      assert.match(b, /MAX_PREPARED_STATEMENTS: '\d+'/);
    }
    assert.match(services['pgbouncer-primary'], /DB_HOST: postgres-primary/);
    assert.match(services['pgbouncer-replica'], /DB_HOST: postgres-replica/);
  });

  it('binds every published port to DB_BIND_ADDR, never to all interfaces', () => {
    for (const n of names) {
      const ports = [...services[n].matchAll(/^ {6}- '([^']+)'$/gm)]
        .map((m) => m[1])
        .filter((v) => /:\d+:\d+$/.test(v));
      assert.ok(ports.length > 0, `${n} publishes a port`);
      for (const port of ports) assert.match(port, /^\$\{DB_BIND_ADDR:\?[^}]+\}:\d+:\d+$/, port);
    }
  });

  it('hardens every container and sets limits, restart policy and UTC', () => {
    for (const n of names) {
      const b = services[n];
      assert.match(b, /cap_drop: \[ALL\]/, n);
      assert.match(b, /no-new-privileges:true/, n);
      assert.match(b, /^ {4}read_only: true$/m, n);
      assert.match(b, /^ {4}restart: unless-stopped$/m, n);
      assert.match(b, /^ {10}memory: \S+/m, n);
      assert.match(b, /^ {10}cpus: '?\S+/m, n);
      assert.match(b, /TZ: UTC/, n);
      assert.doesNotMatch(b, /privileged:\s*true|network_mode:\s*host/, n);
    }
  });

  it('pins images (ours by git SHA, third party by version) and holds no secret values', () => {
    for (const m of compose.matchAll(/^\s+image:\s*(\S+)\s*$/gm)) {
      assert.doesNotMatch(m[1], /:latest$|^[^:]+$/, m[1]);
    }
    assert.doesNotMatch(compose, /(PASSWORD|SECRET|KEY):\s*[^$\s'][^\s]*$/m);
  });
});

describe('Postgres helpers', () => {
  it('pg_hba.stage-b.conf is TLS plus SCRAM only', () => {
    const hba = read('postgres', 'pg_hba.stage-b.conf');
    const rules = hba.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    assert.ok(rules.length > 0);
    for (const rule of rules) {
      assert.doesNotMatch(rule, /\btrust\b|\bmd5\b|\bpassword\b/, rule);
      assert.match(rule, /^(local\s|hostssl\s)/, `no plain host lines: ${rule}`);
    }
    assert.match(hba, /^hostssl\s+replication\s+replicator\s/m);
  });

  it('the replicator role init is a no-op without REPLICATION_PASSWORD', () => {
    const script = path.join(docker, 'postgres', 'init', '03-replicator.sh');
    const r = spawnSync('sh', [script], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(readFileSync(script, 'utf8'), /CREATE ROLE replicator WITH REPLICATION LOGIN/);
  });
});

describe('replica-entrypoint.sh', () => {
  const script = path.join(docker, 'postgres', 'replica-entrypoint.sh');
  let bin;
  let data;
  let log;
  before(() => {
    bin = mkdtempSync(path.join(tmpdir(), 'replica-stubs-'));
    data = path.join(bin, 'data');
    log = path.join(bin, 'calls.log');
    mkdirSync(data);
    const stub = (name, body) => {
      writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
      chmodSync(path.join(bin, name), 0o755);
    };
    stub('pg_isready', 'exit 0');
    stub('pg_basebackup', `echo 17 > "${data}/PG_VERSION"; touch "${data}/standby.signal"`);
    stub('postgres', 'exit 0');
  });
  after(() => rmSync(bin, { recursive: true, force: true }));

  const run = (env = {}) => {
    if (existsSync(log)) rmSync(log);
    const r = spawnSync('sh', [script, 'postgres', '-c', 'hot_standby=on'], {
      env: { PATH: `${bin}:${process.env.PATH}`, PGDATA: data, ...env },
      encoding: 'utf8',
    });
    return { ...r, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
  };

  it('requires PRIMARY_HOST', () => {
    assert.notEqual(run().status, 0);
  });

  it('clones an empty data directory with -R, a slot and the replicator role, then execs postgres', () => {
    const r = run({ PRIMARY_HOST: 'db-primary.example' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.calls,
      /pg_basebackup -h db-primary\.example -p 5432 -U replicator -D .* -X stream -R -C -S replica1/,
    );
    assert.match(r.calls, /^postgres -c hot_standby=on$/m);
  });

  it('starts an existing standby without cloning again', () => {
    const r = run({ PRIMARY_HOST: 'db-primary.example' });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.calls, /pg_basebackup/);
  });

  it('refuses a data directory that is not a standby', () => {
    rmSync(path.join(data, 'standby.signal'));
    const r = run({ PRIMARY_HOST: 'db-primary.example' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /standby\.signal is missing/);
    assert.doesNotMatch(r.calls, /^postgres /m);
  });
});

const hasCompose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
describe('rendered with docker compose config', { skip: !hasCompose }, () => {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? '/tmp',
    IMAGE_ORG: 'org',
    GIT_SHA: 'abc123',
    DB_BIND_ADDR: '203.0.113.9',
    POSTGRES_PASSWORD: 'x',
    APP_DB_PASSWORD: 'x',
    REPLICATION_PASSWORD: 'x',
    PRIMARY_HOST: 'primary.example',
    WALG_S3_PREFIX: 's3://causedeck-wal-hyd',
    WALG_AWS_ENDPOINT: 'https://s3.ap-south-2.amazonaws.com',
    WALG_ARCHIVE_ACCESS_KEY: 'x',
    WALG_ARCHIVE_SECRET_KEY: 'x',
  };
  const render = (...profiles) => {
    const r = spawnSync(
      'docker',
      [
        'compose',
        '-f',
        path.join(docker, 'compose.db.yml'),
        ...profiles.flatMap((p) => ['--profile', p]),
        'config',
        '--format',
        'json',
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).services;
  };

  it('renders a primary and a replica with PgBouncer', () => {
    const s = render('primary', 'replica');
    assert.deepEqual(Object.keys(s).sort(), [
      'pgbouncer-primary',
      'pgbouncer-replica',
      'postgres-primary',
      'postgres-replica',
    ]);
  });

  it('the replica carries primary_conninfo and is read-only; the primary archives WAL', () => {
    const s = render('primary', 'replica');
    const replica = s['postgres-replica'].command.join(' ');
    assert.match(replica, /primary_conninfo=host=primary\.example port=5432 user=replicator/);
    assert.match(replica, /default_transaction_read_only=on/);
    assert.match(replica, /hot_standby=on/);
    assert.equal(s['postgres-primary'].environment.WALG_S3_PREFIX, 's3://causedeck-wal-hyd');
    assert.equal(s['postgres-primary'].environment.AWS_REGION, 'ap-south-2');
    assert.equal(s['postgres-replica'].environment.WALG_S3_PREFIX, undefined);
  });

  it('one profile renders only that node', () => {
    assert.deepEqual(Object.keys(render('primary')).sort(), [
      'pgbouncer-primary',
      'postgres-primary',
    ]);
    assert.deepEqual(Object.keys(render('replica')).sort(), [
      'pgbouncer-replica',
      'postgres-replica',
    ]);
  });
});
