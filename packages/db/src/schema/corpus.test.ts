// Static checks on the judgment corpus schema (#484, D-048): a raw corpus, nothing editorial.
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { GLOBAL_TABLES } from '../conventions.ts';

import { corpusMaskRequest, judgment } from './corpus.ts';

/** Words that would make a column editorial content (headnote, summary, holding, citator, ...). */
const EDITORIAL =
  /headnote|summary|synopsis|holding|ratio|digest|annotation|commentary|citator|treatment|overrul|distinguish|followed|keyword|tag|catchword|abstract|analysis|note/i;

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

  it('has no editorial fields', () => {
    expect(columns.filter((name) => EDITORIAL.test(name))).toEqual([]);
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
