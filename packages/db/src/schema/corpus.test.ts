// Static checks on the judgment corpus schema (#484, D-048). D-053 narrowed the editorial rule (#894):
// the corpus may hold derived facets, but every corpus source must be official or open-licence.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { GLOBAL_TABLES } from '../conventions.ts';

import { corpusMaskRequest, judgment } from './corpus.ts';

import { MIGRATIONS_FOLDER } from '../migrate.ts';

/** `corpus` rows of `source` inserted by a migration: id, base URL, owner and notes. */
const CORPUS_SOURCE_ROW =
  /\('([^']+)', 'corpus', '([^']*)', '((?:[^']|'')*)', '[A-Z0-9]+', '((?:[^']|'')*)'\)/g;
/** An open licence named in the source notes, or an official (government or court) host. */
const OPEN_LICENCE = /licence (?:CC-BY(?:-SA)?-\d\.\d|CC0-1\.0|ODbL-1\.0|OGL-3\.0|GODL-India)/i;
const OFFICIAL_HOST = /^https:\/\/[^/]*\b(?:gov\.in|nic\.in|courts\.in|sci\.gov\.in)\//i;

function corpusSources(): { id: string; baseUrl: string; notes: string }[] {
  const rows: { id: string; baseUrl: string; notes: string }[] = [];
  for (const file of readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql'))) {
    const sqlText = readFileSync(path.join(MIGRATIONS_FOLDER, file), 'utf8');
    for (const m of sqlText.matchAll(CORPUS_SOURCE_ROW))
      rows.push({ id: m[1] ?? '', baseUrl: m[2] ?? '', notes: m[4] ?? '' });
  }
  return rows;
}

describe('judgment schema', () => {
  const columns = Object.values(getTableColumns(judgment)).map((c) => c.name);

  it('has the raw-document columns', () => {
    expect(columns).toEqual(
      expect.arrayContaining([
        'court',
        'neutral_citation',
        'case_numbers',
        'bench',
        'judgment_date',
        'blob_key',
        'sha256',
        'provenance',
        'page_text',
        'embedding',
      ]),
    );
  });

  it('registers only official or open-licence corpus sources (D-053)', () => {
    const sources = corpusSources();
    expect(sources.map((r) => r.id)).toEqual(
      expect.arrayContaining(['aws-open-data-sc', 'aws-open-data-hc']),
    );
    for (const source of sources)
      expect(
        OPEN_LICENCE.test(source.notes) || OFFICIAL_HOST.test(source.baseUrl),
        `${source.id} is neither open-licence nor official`,
      ).toBe(true);
  });

  it('has the enrichment columns (#894)', () => {
    expect(columns).toEqual(
      expect.arrayContaining(['court_level', 'outcome', 'outcome_anchor', 'enrich_version']),
    );
  });

  it('dedupes by sha256 with a unique index', () => {
    const unique = getTableConfig(judgment).indexes.find(
      (i) => i.config.name === 'judgment_sha256_uq',
    );
    expect(unique?.config.unique).toBe(true);
  });

  it('is a global table', () => {
    expect(GLOBAL_TABLES).toContain('judgment');
    expect(columns).not.toContain('workspace_id');
  });

  it('has the redaction columns (#892)', () => {
    expect(columns).toEqual(
      expect.arrayContaining([
        'redacted_text',
        'case_title',
        'title_masked',
        'redaction_version',
        'sensitive_category',
        'mask_reason',
      ]),
    );
  });
});

describe('corpus_mask_request schema', () => {
  const columns = Object.values(getTableColumns(corpusMaskRequest)).map((c) => c.name);

  it('records who, what, legal basis, status and handled_at', () => {
    expect(columns).toEqual(
      expect.arrayContaining([
        'requested_by',
        'requested_action',
        'legal_basis',
        'status',
        'handled_at',
      ]),
    );
  });

  it('is a global table', () => {
    expect(GLOBAL_TABLES).toContain('corpus_mask_request');
    expect(columns).not.toContain('workspace_id');
  });
});
