// Static lint for the production stack (#97): `node --test infra/scripts/`. Mirrors
// compose-dev.test.mjs (plain-text checks, no YAML parser at the root); `docker compose config -q`
// and the smoke job in images.yml cover syntax and runtime behaviour.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const docker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docker');
const read = (file) => readFileSync(path.join(docker, file), 'utf8');
const compose = read('compose.prod.yml');

// Split the `services:` section into { name: block } using the file's fixed 2-space layout.
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
const DAEMONS = ['caddy', 'web', 'api', 'worker', 'admin', 'postgres', 'minio'];

describe('compose.prod.yml services', () => {
  it('defines the production topology with the right replica counts', () => {
    for (const name of [...DAEMONS, 'minio-init', 'migrate']) {
      assert.ok(name in services, `missing service ${name}`);
    }
    assert.match(services.web, /replicas: 2\b/);
    assert.match(services.worker, /replicas: 2\b/);
    for (const single of ['api', 'admin', 'postgres', 'minio', 'caddy']) {
      assert.doesNotMatch(services[single], /replicas:/, `${single} runs a single container`);
    }
  });

  it('never runs privileged and drops every capability, with no-new-privileges', () => {
    for (const name of names) {
      const block = services[name];
      assert.doesNotMatch(block, /privileged:\s*true/, `${name} is privileged`);
      assert.match(block, /cap_drop: \[ALL\]/, `${name} must cap_drop ALL`);
      assert.match(block, /no-new-privileges:true/, `${name} needs no-new-privileges`);
      assert.match(block, /^ {4}read_only: true$/m, `${name} needs a read-only root filesystem`);
      assert.doesNotMatch(
        block,
        /network_mode:\s*host|pid:\s*host|cap_add: \[(?!NET_BIND_SERVICE)/,
      );
    }
    assert.match(services.caddy, /cap_add: \[NET_BIND_SERVICE\]/);
  });

  it('gives every service a restart policy, memory and CPU limits', () => {
    for (const name of names) {
      const block = services[name];
      assert.match(block, /^ {4}restart: /m, `${name} needs a restart policy`);
      assert.match(block, /^ {10}memory: \S+/m, `${name} needs a memory limit`);
      assert.match(block, /^ {10}cpus: '?\S+/m, `${name} needs a CPU limit`);
    }
    for (const name of DAEMONS) {
      assert.match(services[name], /^ {4}restart: unless-stopped$/m);
      assert.match(services[name], /^ {4}healthcheck:$/m, `${name} needs a healthcheck`);
    }
  });

  it('publishes ports only from caddy: 80, 443 and 443/udp', () => {
    for (const name of names.filter((n) => n !== 'caddy')) {
      assert.doesNotMatch(services[name], /^ {4}ports:/m, `${name} must not publish ports`);
    }
    const ports = [...services.caddy.matchAll(/^ {6}- '(\d+:\d+(?:\/udp)?)'$/gm)].map((m) => m[1]);
    assert.deepEqual(ports.sort(), ['443:443', '443:443/udp', '80:80']);
  });

  it('keeps postgres and minio on the internal data network only', () => {
    assert.match(compose, /^ {2}data:\n {4}internal: true$/m);
    for (const name of ['postgres', 'minio']) {
      assert.match(services[name], /networks: \[data\]/, `${name} must only join data`);
    }
    assert.match(services.admin, /networks: \[edge, data\]/);
  });

  it('pins images: third-party by version, ours by git SHA, never latest', () => {
    const images = [...compose.matchAll(/^\s+image:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    for (const image of images) {
      assert.doesNotMatch(image, /:latest$|^[^:]+$/, `${image} must be pinned`);
      if (image.startsWith('ghcr.io/')) {
        assert.match(
          image,
          /^ghcr\.io\/\$\{IMAGE_ORG:\?[^}]+\}\/causedeck-[a-z]+:sha-\$\{GIT_SHA:\?[^}]+\}$/,
        );
      } else {
        assert.match(image.split(':')[1] ?? '', /^\d+\.\d+|^RELEASE\./, `${image} needs a version`);
      }
    }
  });

  it('waits on healthy dependencies and drains with a grace period', () => {
    assert.match(services.caddy, /web:\n\s+condition: service_healthy/);
    assert.match(services.api, /postgres:\n\s+condition: service_healthy/);
    assert.match(services.worker, /stop_grace_period: 40s/);
    assert.match(services.api, /stop_grace_period: 1[5-9]s|stop_grace_period: [2-9]\ds/);
  });

  it('uses UTC everywhere and only the app role for the apps', () => {
    for (const name of names) assert.match(services[name], /TZ: UTC/, `${name} must log in UTC`);
    for (const name of ['web', 'api', 'worker', 'admin']) {
      assert.match(services[name], /DATABASE_URL: postgres:\/\/causedeck_app:/);
      assert.doesNotMatch(
        services[name],
        /DATABASE_URL_OWNER/,
        `${name} must not see the owner role`,
      );
    }
    assert.match(services.migrate, /DATABASE_URL_OWNER: postgres:\/\/causedeck_owner:/);
  });

  it('holds no secret values: every credential is interpolated', () => {
    assert.doesNotMatch(compose, /(PASSWORD|SECRET|KEY):\s*[^$\s'][^\s]*$/m);
  });
});

describe('Dockerfiles', () => {
  for (const name of ['web', 'api', 'worker', 'admin']) {
    const file = read(`${name}.Dockerfile`);
    it(`${name}: numeric non-root user, tini, UTC, no caches, exec-form CMD`, () => {
      assert.match(file, /^USER \d+:\d+$/m);
      assert.doesNotMatch(file, /^USER (root|0)\b/m);
      assert.match(file, /ENTRYPOINT \["\/usr\/bin\/tini", "--"\]/);
      assert.match(file, /TZ=UTC/);
      assert.match(file, /^ARG NODE_IMAGE=node:22\.\d+\.\d+-bookworm-slim$/m);
      assert.match(file, /rm -rf \/var\/lib\/apt\/lists/);
      assert.match(file, /^CMD \[/m);
      assert.match(file, /^HEALTHCHECK /m);
    });
  }

  it('api and worker prune with pnpm deploy --prod', () => {
    for (const name of ['api', 'worker']) assert.match(read(`${name}.Dockerfile`), /--prod deploy/);
  });

  it('the worker image carries the owner-role migration entry', () => {
    assert.match(read('worker.Dockerfile'), /scripts\/migrate\.ts/);
    assert.match(compose, /node_modules\/@causedeck\/db\/scripts\/migrate\.ts/);
  });

  it('the dockerignore keeps host artefacts out of the context', () => {
    const ignore = read('.dockerignore');
    for (const entry of ['**/node_modules', '**/.next', '.git', '.forge-lean', 'docs']) {
      assert.ok(ignore.split('\n').includes(entry), `${entry} must be ignored`);
    }
  });
});

describe('postgres image and config', () => {
  const conf = read('postgres/postgresql.conf');
  const dockerfile = read('postgres/Dockerfile');

  it('archives WAL through wal-g with env-provided storage', () => {
    assert.match(conf, /^archive_mode = on$/m);
    assert.match(conf, /^archive_command = 'wal-g wal-push %p'$/m);
    assert.match(compose, /WALG_S3_PREFIX: \$\{WALG_S3_PREFIX:-s3:\/\/causedeck-wal\}/);
    assert.match(compose, /AWS_ENDPOINT: \$\{WALG_AWS_ENDPOINT:-http:\/\/minio:9000\}/);
  });

  it('enforces TLS, UTC and never logs statements', () => {
    assert.match(conf, /^ssl = on$/m);
    assert.match(conf, /^timezone = 'UTC'$/m);
    assert.match(conf, /^log_statement = 'none'$/m);
  });

  it('bundles pgvector and a checksum-verified per-arch WAL-G', () => {
    assert.match(dockerfile, /ARG PG_IMAGE=pgvector\/pgvector:[\d.]+-pg17/);
    assert.match(dockerfile, /sha256sum -c -/);
    assert.match(dockerfile, /WALG_SHA256_AMD64/);
    assert.match(dockerfile, /WALG_SHA256_ARM64/);
    assert.match(dockerfile, /postgres\/init \/docker-entrypoint-initdb\.d/);
  });
});

describe('env examples', () => {
  const keys = (text) => new Set([...text.matchAll(/^#? ?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const prod = read('env/prod.env.example');
  const staging = read('env/staging.env.example');

  it('are variables only: no value that looks like a secret', () => {
    for (const text of [prod, staging]) {
      assert.doesNotMatch(text, /^(\w*(SECRET|PASSWORD|KEY|KEK\w*))=\S+/m);
    }
  });

  it('cover every ${VAR:?} the compose file requires', () => {
    const required = [...compose.matchAll(/\$\{([A-Z_]+):\?/g)].map((m) => m[1]);
    const available = keys(prod);
    for (const key of required.filter((k) => k !== 'CAUSEDECK_ENV_FILE')) {
      assert.ok(available.has(key), `prod.env.example is missing ${key}`);
    }
  });

  it('staging shrinks the limits and uses preview data and mock providers', () => {
    assert.match(staging, /^COMPOSE_ENV_NAME=staging$/m);
    assert.match(staging, /^WEB_MEM=384m$/m);
    assert.match(staging, /^POSTGRES_MEM=1g$/m);
    assert.match(staging, /^AI_PROVIDER=mock$/m);
    assert.match(staging, /preview data only/i);
  });
});

describe('backup services (#101)', () => {
  it('defines the backup profile services hardened like the rest', () => {
    for (const name of ['backup', 'minio-replicate']) {
      assert.ok(name in services, `missing service ${name}`);
      assert.match(services[name], /profiles: \[backup\]/);
      assert.match(services[name], /read_only: true/);
      assert.match(services[name], /cap_drop: \[ALL\]/);
      assert.match(services[name], /no-new-privileges:true/);
      assert.match(services[name], /memory:/);
    }
    assert.match(services.backup, /user: postgres/);
    assert.match(services.backup, /pgdata:\/var\/lib\/postgresql\/data:ro/);
  });

  it('mounts the libsodium key as a secret file, never an inline value', () => {
    assert.match(compose, /^secrets:\n {2}walg_key:\n {4}file: \$\{WALG_KEY_FILE/m);
    for (const name of ['postgres', 'backup']) {
      assert.match(services[name], /secrets: \[walg_key\]/);
      assert.match(services[name], /WALG_LIBSODIUM_KEY_PATH: \/run\/secrets\/walg_key/);
      assert.match(services[name], /WALG_LIBSODIUM_KEY_TRANSFORM: hex/);
    }
    assert.doesNotMatch(compose, /WALG_LIBSODIUM_KEY:/);
  });

  it('versions and locks down the wal and ops buckets', () => {
    for (const b of ['causedeck-wal', 'causedeck-ops']) {
      assert.match(services['minio-init'], new RegExp(`mc version enable local/${b}`));
      assert.match(services['minio-init'], new RegExp(`mc anonymous set none local/${b}`));
    }
  });

  it('gives the archiver its own write-only credential variables', () => {
    assert.match(services.postgres, /WALG_ARCHIVE_ACCESS_KEY/);
    assert.match(services.backup, /WALG_ADMIN_ACCESS_KEY/);
  });
});
