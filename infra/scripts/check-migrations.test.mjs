// Expand-only migration check (#100): `node --test infra/scripts/`.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkDirectory, checkMigration } from './check-migrations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('checkMigration', () => {
  it('accepts additive changes', () => {
    const sql = `ALTER TABLE "t" ADD COLUMN "x" text NOT NULL DEFAULT 'a';\nCREATE INDEX i ON t (x);\nALTER TABLE "t" ALTER COLUMN "y" DROP NOT NULL;`;
    assert.deepEqual(checkMigration('0001.sql', sql), []);
  });
  it('rejects DROP COLUMN', () => {
    assert.equal(checkMigration('a.sql', 'ALTER TABLE "t" DROP COLUMN "x";').length, 1);
  });
  it('rejects DROP TABLE', () => {
    assert.equal(checkMigration('a.sql', 'drop table "t";').length, 1);
  });
  it('rejects ALTER COLUMN ... SET NOT NULL', () => {
    assert.equal(checkMigration('a.sql', 'ALTER TABLE "t" ALTER COLUMN "x" SET NOT NULL;').length, 1);
  });
  it('allows a destructive change tagged contract', () => {
    assert.deepEqual(checkMigration('a.sql', '-- contract\nALTER TABLE "t" DROP COLUMN "x";'), []);
  });
  it('ignores keywords in comments and string literals', () => {
    const sql = `-- we will DROP COLUMN later\nINSERT INTO t VALUES ('DROP COLUMN x');\n/* SET NOT NULL */`;
    assert.deepEqual(checkMigration('a.sql', sql), []);
  });
});

describe('checkDirectory', () => {
  it('skips migrations already applied by the previous release', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
    writeFileSync(path.join(dir, '0001_old.sql'), 'ALTER TABLE t DROP COLUMN x;');
    writeFileSync(path.join(dir, '0002_new.sql'), 'ALTER TABLE t ADD COLUMN y int;');
    assert.equal(checkDirectory(dir).length, 1);
    assert.deepEqual(checkDirectory(dir, ['0001_old.sql']), []);
  });
  it('passes on the repository migrations', () => {
    assert.deepEqual(checkDirectory(path.join(root, 'packages/db/migrations')), []);
  });
});
