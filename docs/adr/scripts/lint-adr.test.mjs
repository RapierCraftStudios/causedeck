// Regression tests for `pnpm adr:lint`: `node --test docs/adr/scripts/` (`pnpm adr:test`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { lintAdrDir, parseAdr, parseIndex } from './lint-adr.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, '__fixtures__', name);
const problemsFor = (name) => lintAdrDir(fixture(name)).join('\n');

describe('lint-adr', () => {
  it('accepts a valid ADR directory', () => {
    assert.deepEqual(lintAdrDir(fixture('valid')), []);
  });

  it('accepts the real ADR log in docs/adr', () => {
    assert.deepEqual(lintAdrDir(path.join(here, '..')), []);
  });

  it('parses the H1, sections, status and date', () => {
    const adr = parseAdr('# 0007. A title\n\n## Status\n\n**Accepted**\n\n## Date\n\n2026-10-18\n');
    assert.equal(adr.number, '0007');
    assert.equal(adr.title, 'A title');
    assert.equal(adr.status, 'Accepted');
    assert.equal(adr.date, '2026-10-18');
    assert.ok(adr.headings.has('Status'));
  });

  it('parses index rows and ignores other tables', () => {
    const rows = parseIndex(
      '| ADR | Title |\n| --- | --- |\n| [0001](0001-a.md) | A | Accepted | 2026-10-18 | — |\n| `x` | y |\n',
    );
    assert.deepEqual(rows, [
      { number: '0001', file: '0001-a.md', title: 'A', status: 'Accepted', date: '2026-10-18' },
    ]);
  });

  const failures = [
    ['missing-adr', /ADR 0002 is missing/],
    ['misnumbered', /heading number 0003 does not match file number 0002/],
    ['duplicate-number', /ADR 0001 is used by several files/],
    ['bad-filename', /0002_Second\.md: file name must be NNNN-kebab-case-title\.md/],
    ['missing-heading', /missing section "## Revisit when"/],
    ['bad-status', /status "Approved" is not one of proposed\|accepted\|superseded\|deprecated/],
    ['bad-date', /date "18 Oct 2026" is not YYYY-MM-DD/],
    ['missing-index-row', /index has no row for 0002-second-decision\.md/],
    ['index-mismatch', /row 0002 title "Second choice" does not match "Second decision"/],
    ['index-mismatch', /row 0002 status "Accepted" does not match "Superseded"/],
    ['index-extra-row', /row 0002 has no ADR file/],
  ];
  for (const [name, expected] of failures) {
    it(`reports ${name}: ${expected.source}`, () => {
      assert.match(problemsFor(name), expected);
    });
  }

  it('exits non-zero from the CLI on a malformed directory', () => {
    const cli = path.join(here, 'lint-adr.mjs');
    const bad = spawnSync(process.execPath, [cli, fixture('missing-heading')], {
      encoding: 'utf8',
    });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /adr:lint: .*Revisit when/);
    const good = spawnSync(process.execPath, [cli, fixture('valid')], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
  });
});
