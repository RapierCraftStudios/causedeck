// SCR citation backfill (#1189): a data-only migration that appends `[YYYY] V SCR P1` to case_numbers of
// already imported AWS Supreme Court rows (from the member name in provenance.url) and sets their court
// to INSC. The neutral citation column is never written (verifyCitation resolves on it alone).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../migrate.ts';

const file = readdirSync(MIGRATIONS_FOLDER).find((f) => f.endsWith('_scr_citation_backfill.sql'));
const migration = readFileSync(path.join(MIGRATIONS_FOLDER, file ?? 'missing.sql'), 'utf8');
const journal = JSON.parse(
  readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
) as { entries: { tag: string }[] };

/** The member-name pattern of the migration, run as a JS regex (same syntax, case-insensitive). */
function memberPattern(): RegExp {
  const m = /, '(\(\?:\^[^']+)', 'i'\)/.exec(migration);
  return new RegExp(m?.[1] ?? '^$', 'i');
}

describe('scr_citation_backfill migration', () => {
  it('is journalled and data-only', () => {
    expect(file).toBeDefined();
    expect(journal.entries.map((e) => e.tag)).toContain(file?.replace(/\.sql$/, ''));
    expect(migration).toMatch(/^-- Reviewed-by: (?!<unreviewed>).+$/m);
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP|TRUNCATE|DELETE|GRANT)\b/);
  });

  it('never writes neutral_citation and only touches aws-open-data-sc rows', () => {
    expect(migration).not.toMatch(/"?neutral_citation"?\s*=/);
    const updates = migration.split('--> statement-breakpoint');
    expect(updates).toHaveLength(3);
    for (const statement of updates)
      expect(statement).toMatch(/"?source_id"? = 'aws-open-data-sc'/);
  });

  it('is idempotent: appends only a missing citation and rewrites only non-INSC courts', () => {
    expect(migration).toContain('NOT (cited.citation = ANY (j.case_numbers))');
    expect(migration).toContain(`"court" <> 'INSC'`);
    expect(migration).toContain(`s.court <> 'INSC'`);
  });

  it('matches only the English member after the URL fragment, like parseScrCitation', () => {
    const pattern = memberPattern();
    expect(pattern.exec('2008_9_821_869_EN.pdf')?.slice(1, 5)).toEqual(['2008', '9', '821', '869']);
    expect(pattern.test('english/2019_14_1_12_en.PDF')).toBe(true);
    for (const name of [
      '2008_9_821_869_HI.pdf',
      '2008_9_821_869_TA.pdf',
      '2008_9_821_869.pdf',
      '2008_9_821_EN.pdf',
      'x2008_9_821_869_EN.pdf',
      '2008_9_821_869_EN.pdf.gz',
      '2008-9-821-869-EN.pdf',
    ])
      expect(pattern.test(name), name).toBe(false);
    // Range checks the regex cannot express stay in SQL, and the citation is built without leading zeros.
    expect(migration).toContain('m[1]::int >= 1950');
    expect(migration).toContain('m[4]::int >= m[3]::int');
    expect(migration).toContain(`format('[%s] %s SCR %s', m[1]::int, m[2]::int, m[3]::int)`);
  });
});
