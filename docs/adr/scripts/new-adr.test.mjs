// Regression tests for `pnpm adr:new`: `node --test docs/adr/scripts/` (`pnpm adr:test`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { lintAdrDir } from './lint-adr.mjs';
import { createAdr, nextNumber, slugify } from './new-adr.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let dir;

describe('new-adr', () => {
  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'adr-new-')), 'adr');
    cpSync(path.join(here, '__fixtures__', 'valid'), dir, { recursive: true });
  });
  afterEach(() => rmSync(path.dirname(dir), { recursive: true, force: true }));

  it('slugifies titles', () => {
    assert.equal(slugify('  Use Postgres 18: RLS & pgvector! '), 'use-postgres-18-rls-pgvector');
  });

  it('picks the next number after the highest ADR', () => {
    assert.equal(nextNumber(dir), '0003');
  });

  it('creates the ADR from the template, indexes it, and the result lints clean', () => {
    const file = createAdr({ dir, title: 'Adopt a thing', date: '2026-11-01' });
    assert.equal(path.basename(file), '0003-adopt-a-thing.md');
    const body = readFileSync(file, 'utf8');
    assert.match(body, /^# 0003\. Adopt a thing\n/);
    assert.match(body, /## Status\n\nProposed\n/);
    assert.match(body, /## Date\n\n2026-11-01\n/);
    assert.doesNotMatch(body, /\{\{/);
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf8');
    assert.match(
      readme,
      /\| \[0002\][^\n]*\n\| \[0003\]\(0003-adopt-a-thing\.md\) \| Adopt a thing \| Proposed \| 2026-11-01 \| — \|\n/,
    );
    assert.deepEqual(lintAdrDir(dir), []);
  });

  it('refuses to overwrite an existing file', () => {
    cpSync(path.join(dir, '0002-second-decision.md'), path.join(dir, '0003-adopt-a-thing.md'));
    // 0003 now exists, so the next number is 0004 and nothing is overwritten.
    const file = createAdr({ dir, title: 'Adopt a thing', date: '2026-11-01' });
    assert.equal(path.basename(file), '0004-adopt-a-thing.md');
    assert.match(readFileSync(path.join(dir, '0003-adopt-a-thing.md'), 'utf8'), /Second decision/);
  });

  it('rejects titles without letters or digits', () => {
    assert.throws(() => createAdr({ dir, title: '!!!', date: '2026-11-01' }), /letters or digits/);
    assert.equal(existsSync(path.join(dir, '0003-.md')), false);
  });

  it('works from the CLI with --dir and --date', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(here, 'new-adr.mjs'), 'CLI made', 'this', '--dir', dir, '--date', '2026-12-31'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0003-cli-made-this\.md/);
    assert.deepEqual(lintAdrDir(dir), []);
  });
});
