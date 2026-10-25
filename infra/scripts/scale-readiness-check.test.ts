// Unit tests for `pnpm scale-readiness`:
//   node --experimental-strip-types --no-warnings --test infra/scripts/scale-readiness-check.test.ts
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkEnvOnlyConfig,
  checkHealthRoutes,
  checkIdempotencyTests,
  checkMigrations,
  checkStatelessServices,
  parseComposeServices,
  runChecks,
} from './scale-readiness-check.ts';

const service = (name: string, extra = ''): string =>
  `  ${name}:\n    image: x\n    read_only: true\n    env_file: .env\n${extra}`;
const compose = (extra: Record<string, string> = {}): string =>
  `services:\n${['web', 'api', 'worker', 'admin'].map((n) => service(n, extra[n])).join('')}volumes:\n  pgdata:\n`;

describe('scale-readiness rules', () => {
  it('passes a stateless compose file and parses services', () => {
    assert.equal(parseComposeServices(compose()).size, 4);
    assert.deepEqual(checkStatelessServices(compose()), []);
  });

  it('flags a volume, a writable root and a missing env_file on an app service', () => {
    const volume = checkStatelessServices(compose({ web: '    volumes:\n      - data:/data\n' }));
    assert.equal(volume.length, 1);
    assert.match(volume[0]?.detail ?? '', /web: local volumes/);
    const writable = compose().replace('read_only: true', 'read_only: false');
    assert.ok(checkStatelessServices(writable).some((f) => f.detail.includes('read_only')));
    const noEnv = compose().replace('    env_file: .env\n', '');
    assert.ok(checkStatelessServices(noEnv).some((f) => f.rule === 'env-config'));
    assert.ok(checkStatelessServices('services:\n').length >= 4);
  });

  it('requires /healthz and /readyz GET handlers', () => {
    const get = 'export function GET() { return new Response("ok"); }';
    assert.deepEqual(checkHealthRoutes({ healthz: get, readyz: get }), []);
    assert.equal(checkHealthRoutes({ healthz: get }).length, 1);
    assert.equal(checkHealthRoutes({}).length, 2);
  });

  it('flags hardcoded endpoints but not comments or env reads', () => {
    assert.deepEqual(
      checkEnvOnlyConfig({
        'a.ts': 'const u = process.env.S3_ENDPOINT;\n// http://localhost:9000',
      }),
      [],
    );
    const bad = checkEnvOnlyConfig({ 'a.ts': "const u = 'http://localhost:9000';" });
    assert.equal(bad.length, 1);
    assert.match(bad[0]?.detail ?? '', /a\.ts:1/);
    assert.equal(
      checkEnvOnlyConfig({ 'b.ts': 'fetch("https://x.s3.ap-south-1.amazonaws.com")' }).length,
      1,
    );
  });

  it('needs an idempotency test in the worker', () => {
    assert.deepEqual(checkIdempotencyTests({ 'a.test.ts': "it('is idempotent', () => {})" }), []);
    assert.equal(checkIdempotencyTests({ 'a.test.ts': "it('runs', () => {})" }).length, 1);
  });

  it('allows additive migrations and requires a marker for destructive ones', () => {
    assert.deepEqual(checkMigrations({ '1.sql': 'alter table t add column c text;' }), []);
    assert.deepEqual(
      checkMigrations({ '2.sql': '-- drop table t is only a comment\nselect 1;' }),
      [],
    );
    assert.equal(checkMigrations({ '3.sql': 'ALTER TABLE t DROP COLUMN c;' }).length, 1);
    assert.equal(checkMigrations({ '4.sql': 'alter table t rename to u;' }).length, 1);
    assert.deepEqual(
      checkMigrations({
        '5.sql': '-- contract: c unused since 0123\nalter table t drop column c;',
      }),
      [],
    );
  });

  it('holds on the repository itself', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    assert.deepEqual(runChecks(root), []);
  });
});
