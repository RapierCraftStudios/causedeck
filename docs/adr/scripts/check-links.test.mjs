// Regression tests for `pnpm docs:links`: `node --test docs/adr/scripts/` (`pnpm adr:test`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { anchorsOf, checkLinks, slugifyHeading } from './check-links.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const links = (name) => path.join(here, '__fixtures__', 'links', name);

describe('check-links', () => {
  it('builds GitHub-style anchors', () => {
    assert.equal(
      slugifyHeading('3.2 Scale path (designed in from day one)'),
      '32-scale-path-designed-in-from-day-one',
    );
    assert.equal(
      slugifyHeading('5. Domain services (`packages/core`)'),
      '5-domain-services-packagescore',
    );
    assert.deepEqual([...anchorsOf('# A\n\n## A\n\n```\n# not a heading\n```\n')], ['a', 'a-1']);
  });

  it('accepts resolving links, anchors and external links, and skips code', () => {
    assert.deepEqual(checkLinks([links('valid.md')]), []);
  });

  it('reports a link to a missing file', () => {
    assert.match(
      checkLinks([links('broken-file.md')]).join('\n'),
      /broken-file\.md:3: sub\/missing\.md does not exist/,
    );
  });

  it('reports a link to a missing heading', () => {
    assert.match(
      checkLinks([links('broken-anchor.md')]).join('\n'),
      /broken-anchor\.md:3: sub\/target\.md#no-such-heading has no heading #no-such-heading/,
    );
  });

  it('passes on the real ADRs and the spike by default, and exits non-zero on a broken link', () => {
    const cli = path.join(here, 'check-links.mjs');
    const good = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    const bad = spawnSync(process.execPath, [cli, links('broken-file.md')], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
  });
});
