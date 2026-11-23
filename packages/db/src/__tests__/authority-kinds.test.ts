// Citation kinds for corpus verification (#1133, part 1 of #1117): authority_kind_chk is widened
// to case_number and section by dropping and recreating it; any other kind is still rejected, and
// `resolution` may hold a pinpoint and the quote check status (never quote text). Runs as the app role
// in rolled-back transactions on the migrated test database.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { CITATION_KINDS } from '@causedeck/validators/citation';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { MIGRATIONS_FOLDER } from '../migrate.ts';
import { AUTHORITY_KINDS, authority } from '../schema/authority.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { seedTwoTenants } from '../testing/two-tenants.ts';
import { sqlState } from './rls/fixtures.ts';

type Ids = { workspaceId: string; draftVersionId: string };

/** Run `fn` scoped to a fresh workspace (FORCE RLS) on its seeded draft version; rolled back. */
async function onSeededVersion(fn: (scoped: Transaction, ids: Ids) => Promise<void>) {
  await withTestDb(async (tx) => {
    const { a, ua } = await seedTwoTenants(tx);
    const { draftVersionId } = a.rows.authority as { draftVersionId: string };
    await inWorkspace(tx, a.id, (scoped) => fn(scoped, { workspaceId: a.id, draftVersionId }), ua);
  });
}

const row = (
  ids: Ids,
  kind: string,
  start: number,
  resolution: typeof authority.$inferInsert.resolution = {},
) => ({
  ...ids,
  blockId: 'b',
  span: [start, start + 5] as [number, number],
  rawText: `cite ${String(start)}`,
  normalized: `cite ${String(start)}`,
  kind,
  status: 'unknown',
  resolution,
});

describe('authority kinds (#1133)', () => {
  it('keep the schema list in step with the validators list', () => {
    expect([...AUTHORITY_KINDS]).toEqual([...CITATION_KINDS]);
    expect(AUTHORITY_KINDS).toEqual(['neutral', 'reporter', 'case_name', 'case_number', 'section']);
  });

  it('insert case_number and section rows, with a pinpoint and quote status in resolution', async () => {
    await onSeededVersion(async (tx, ids) => {
      const rows = await tx
        .insert(authority)
        .values([
          row(ids, 'case_number', 0),
          row(ids, 'section', 10, {
            reason: 'quote_not_found',
            pinpoint: { para: 12, paraEnd: 14 },
            quote: 'not_found',
          }),
        ])
        .returning({ kind: authority.kind, resolution: authority.resolution });
      expect(rows.map((r) => r.kind)).toEqual(['case_number', 'section']);
      expect(rows[1]?.resolution).toEqual({
        reason: 'quote_not_found',
        pinpoint: { para: 12, paraEnd: 14 },
        quote: 'not_found',
      });
    });
  });

  it('still insert the existing kinds', async () => {
    await onSeededVersion(async (tx, ids) => {
      const rows = await tx
        .insert(authority)
        .values([row(ids, 'neutral', 0), row(ids, 'reporter', 10), row(ids, 'case_name', 20)])
        .returning({ id: authority.id });
      expect(rows).toHaveLength(3);
    });
  });

  it('reject any other kind with authority_kind_chk', async () => {
    await onSeededVersion(async (tx, ids) => {
      const error: unknown = await tx
        .transaction((sp) => sp.insert(authority).values(row(ids, 'statute', 0)))
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
      expect(cause?.code).toBe('23514');
      expect(cause?.constraint_name).toBe('authority_kind_chk');
      expect(
        await sqlState(tx.transaction((sp) => sp.insert(authority).values(row(ids, '', 10)))),
      ).toBe('23514');
    });
  });
});

describe('authority_kinds migration (#1133)', () => {
  const file = readdirSync(MIGRATIONS_FOLDER).find((f) => f.endsWith('_authority_kinds.sql'));
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };

  it('is in the journal under its file name', () => {
    expect(file).toBe('20261031181219_authority_kinds.sql');
    expect(journal.entries.map((e) => e.tag)).toContain('20261031181219_authority_kinds');
  });

  it('only drops and recreates authority_kind_chk with the five kinds', () => {
    const statements = readFileSync(path.join(MIGRATIONS_FOLDER, file ?? ''), 'utf8')
      .split('\n')
      .filter((l) => !l.startsWith('--') && l.trim() !== '')
      .join('\n')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual([
      'ALTER TABLE "authority" DROP CONSTRAINT "authority_kind_chk";',
      `ALTER TABLE "authority" ADD CONSTRAINT "authority_kind_chk" CHECK (kind in ('neutral', 'reporter', 'case_name', 'case_number', 'section'));`,
    ]);
  });
});
