// Regression tests for the local dev stack definition: `node --test infra/scripts/`.
// Plain-text checks (no YAML parser at the root); `docker compose config -q` in CI validates syntax.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const docker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docker');
const read = (file) => readFileSync(path.join(docker, file), 'utf8');
const compose = read('compose.dev.yml');

describe('compose.dev.yml', () => {
  it('defines the postgres, minio, minio-init and mailpit services', () => {
    for (const service of ['postgres', 'minio', 'minio-init', 'mailpit']) {
      assert.match(compose, new RegExp(`^  ${service}:$`, 'm'), `missing service ${service}`);
    }
  });

  it('pins every image to a version tag, never latest', () => {
    const images = [...compose.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    assert.equal(images.length, 4);
    for (const image of images) {
      const tag = image.split(':')[1] ?? '';
      assert.ok(tag && tag !== 'latest', `${image} must be pinned`);
      assert.match(tag, /\d+\.\d+|RELEASE\.\d{4}-\d{2}-\d{2}/, `${image} needs a version tag`);
    }
    assert.match(compose, /image: pgvector\/pgvector:[\d.]+-pg17\n/);
  });

  it('binds every published port to 127.0.0.1', () => {
    const ports = [...compose.matchAll(/^\s*-\s*'?(\S+?:\d+:\d+)'?\s*$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(
      ports.map((port) => Number(port.split(':')[1])).sort((a, b) => a - b),
      [1025, 5432, 8025, 9000, 9001],
    );
    for (const port of ports)
      assert.ok(port.startsWith('127.0.0.1:'), `${port} must bind localhost`);
  });

  it('creates the versioned dev bucket and mounts the Postgres init scripts', () => {
    assert.match(compose, /mc mb --ignore-existing local\/causedeck-dev/);
    assert.match(compose, /mc version enable local\/causedeck-dev/);
    assert.match(compose, /mc anonymous set none local\/causedeck-dev/);
    assert.match(compose, /\.\/postgres\/init:\/docker-entrypoint-initdb\.d/);
    assert.match(compose, /shm_size: 256mb/);
    assert.match(compose, /\/minio\/health\/live/);
    assert.match(compose, /pg_isready/);
  });
});

describe('postgres init scripts', () => {
  it('creates every required extension', () => {
    const sql = read('postgres/init/01-extensions.sql');
    for (const ext of ['vector', 'pgcrypto', 'citext', 'pg_trgm', 'unaccent']) {
      assert.match(sql, new RegExp(`CREATE EXTENSION IF NOT EXISTS ${ext};`));
    }
  });

  it('makes the app role a non-owner that cannot bypass RLS or create in public', () => {
    const sql = read('postgres/init/02-roles.sql');
    assert.match(sql, /CREATE ROLE causedeck_app[\s\S]*?NOSUPERUSER NOBYPASSRLS/);
    assert.match(sql, /ALTER SCHEMA public OWNER TO causedeck_owner;/);
    assert.match(sql, /REVOKE CREATE ON SCHEMA public FROM PUBLIC;/);
    assert.match(
      sql,
      /ALTER DEFAULT PRIVILEGES FOR ROLE causedeck_owner IN SCHEMA public\s+GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO causedeck_app;/,
    );
  });
});
