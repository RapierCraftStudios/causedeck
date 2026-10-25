// The DRT/DRAT adapter and the national NCLT benches (#662): registry resolution, the bundled
// config, the catalogue agreeing with the adapters' forum codes, and the cause-list parser.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterConfigSchema } from '../config/schema.ts';
import { BUNDLED_ADAPTER_CONFIGS } from '../config/loader.ts';
import {
  NCLT_ADAPTER_ID,
  NCLT_BENCH_FORUM_CODES,
  NCLT_FORUM_CODES,
  createNcltAdapter,
} from '../nclt-blr/index.ts';
import { createAdapterRegistry } from '../registry.ts';
import { WORKBENCH_ADAPTERS } from '../workbench/index.ts';

import {
  DRT_ADAPTER_ID,
  DRT_BUNDLED,
  DRT_CONFIG,
  DRT_FORUM_CODES,
  createDrtAdapter,
} from './index.ts';

const CATALOGUE_TEST = readFileSync(
  path.resolve(import.meta.dirname, '../../../db/src/seed/forum-catalogue/forum-catalogue.test.ts'),
  'utf8',
);

/** The forum codes the catalogue test expects (it lists every seeded code) for one prefix. */
const seeded = (prefix: string) =>
  [...CATALOGUE_TEST.matchAll(/^\s+'(in\.[a-z0-9.-]+)',$/gm)]
    .map((match) => match[1] ?? '')
    .filter((code) => code.startsWith(prefix));

const page = (rows: string, header = 'Sl No</th><th>Case No</th><th>Parties</th><th>Purpose') =>
  `<h2>Cause List for 22-10-2026</h2><table><tr><th>${header}</th></tr>${rows}</table>`;

const parse = (html: string) =>
  createDrtAdapter().parseCauseList({
    kind: 'html',
    html,
    meta: { forumCode: 'in.drt.delhi-1', receivedAt: '2026-10-21T04:00:00.000Z' },
  } as never);

describe('DRT/DRAT adapter registration', () => {
  it('resolves every DRT and DRAT forum code, and every NCLT bench, through the registry', () => {
    const registry = createAdapterRegistry();
    const drt = createDrtAdapter();
    const nclt = createNcltAdapter();
    registry.register(drt);
    registry.register(nclt);
    for (const code of DRT_FORUM_CODES) expect(registry.resolveByForum(code), code).toBe(drt);
    for (const code of NCLT_FORUM_CODES) expect(registry.resolveByForum(code), code).toBe(nclt);
    expect(NCLT_FORUM_CODES).toHaveLength(NCLT_BENCH_FORUM_CODES.length + 1);
    expect(nclt.id).toBe(NCLT_ADAPTER_ID);
  });

  it('is bundled, validates and is covered by the workbench', () => {
    expect(AdapterConfigSchema.parse(DRT_CONFIG)).toEqual(DRT_CONFIG);
    expect(BUNDLED_ADAPTER_CONFIGS[DRT_ADAPTER_ID]).toEqual(DRT_BUNDLED);
    expect(WORKBENCH_ADAPTERS[DRT_ADAPTER_ID]?.().id).toBe(DRT_ADAPTER_ID);
  });

  it('serves exactly the forums the catalogue lists, and no adapter reads from the network', () => {
    expect([...DRT_FORUM_CODES].sort()).toEqual(
      [...seeded('in.drt.'), ...seeded('in.drat.')].sort(),
    );
    expect([...NCLT_FORUM_CODES].sort()).toEqual(seeded('in.nclt.').sort());
    expect(createDrtAdapter().accessModes).toMatchObject({ status: 'none', orders: 'none' });
  });
});

describe('DRT cause-list parser', () => {
  it('reads halls, rows, purposes and the list date', async () => {
    const list = await parse(
      page(
        '<tr><td colspan="4">Court: DRT-1 Delhi</td></tr>' +
          '<tr><td>1</td><td>OA/12/2026</td><td>A vs B</td><td>Hearing</td></tr>' +
          '<tr><td>2</td><td>junk</td><td>C vs D</td><td></td></tr>',
      ),
    );
    expect(list.status).toBe('ok');
    expect(list.listDate).toBe('2026-10-22');
    expect(list.halls).toHaveLength(1);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ matchKey: 'OA/12/2026', stageNorm: 'hearing' });
    expect(list.unparsedRows).toHaveLength(1);
  });

  it('reports a page without a case-number column as not a cause list, and never throws', async () => {
    for (const html of ['', '<<<', 'plain text', '<table><tr><td>x</td></tr></table>']) {
      expect((await parse(html)).status).toBe('not_a_cause_list');
    }
  });

  it('reports a header-only table as empty', async () => {
    expect((await parse(page(''))).status).toBe('empty');
  });
});
