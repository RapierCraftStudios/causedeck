import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.resolve(import.meta.dirname, '../../db/migrations/0057_document_search.sql'),
  'utf8',
);

describe('document search schema (migration 0057)', () => {
  it('generates the page tsvector with the simple config, so Tamil and English words match whole', () => {
    expect(migration).toContain(
      "GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text, ''))) STORED",
    );
    expect(migration).toContain('USING gin ("search_tsv")');
  });

  it('makes (workspace, capture, pipeline version) unique for idempotency', () => {
    expect(migration).toContain('UNIQUE("workspace_id","source_capture_id","pipeline_version")');
  });
});
