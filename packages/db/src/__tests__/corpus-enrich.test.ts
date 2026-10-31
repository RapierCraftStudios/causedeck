// Corpus enrichment schema (#894, ADR 0051 §Enrichment): the three facet tables are global, carry the
// version that produced each row, and the migration grants the app role only what the job needs.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { GLOBAL_TABLES } from '../conventions.ts';
import { MIGRATIONS_FOLDER } from '../migrate.ts';
import { judgmentCitationRef, judgmentStatuteRef, judgmentTag } from '../schema/corpus.ts';

const file = readdirSync(MIGRATIONS_FOLDER).find((f) => f.endsWith('_corpus_enrich.sql')) ?? '';
const migration = readFileSync(path.join(MIGRATIONS_FOLDER, file), 'utf8');
const names = (table: Parameters<typeof getTableColumns>[0]) =>
  Object.values(getTableColumns(table)).map((c) => c.name);

describe('judgment enrichment tables', () => {
  it('judgment_statute_ref holds judgment, statute, section, page and a ruleset version', () => {
    expect(names(judgmentStatuteRef)).toEqual(
      expect.arrayContaining(['judgment_id', 'statute', 'section', 'page', 'ruleset_version']),
    );
  });

  it('judgment_citation_ref holds the citation strings and a nullable cited judgment', () => {
    expect(names(judgmentCitationRef)).toEqual(
      expect.arrayContaining([
        'judgment_id',
        'raw_citation',
        'normalised_citation',
        'cited_judgment_id',
        'page',
        'ruleset_version',
      ]),
    );
    expect(getTableColumns(judgmentCitationRef).citedJudgmentId.notNull).toBe(false);
  });

  it('judgment_tag holds the area, confidence and model version', () => {
    expect(names(judgmentTag)).toEqual(
      expect.arrayContaining(['judgment_id', 'subject_area', 'confidence', 'model_version']),
    );
  });

  it('are global tables with no workspace_id', () => {
    for (const [name, table] of [
      ['judgment_statute_ref', judgmentStatuteRef],
      ['judgment_citation_ref', judgmentCitationRef],
      ['judgment_tag', judgmentTag],
    ] as const) {
      expect(GLOBAL_TABLES).toContain(name);
      expect(names(table)).not.toContain('workspace_id');
    }
  });
});

describe('corpus_enrich migration', () => {
  it('lets the app role read, insert and delete facets but update only the enrichment columns', () => {
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, DELETE ON "judgment_statute_ref", "judgment_citation_ref", "judgment_tag" TO causedeck_app/,
    );
    expect(migration).toMatch(
      /GRANT UPDATE \("court_level", "outcome", "outcome_anchor", "enrich_version", "enriched_redaction_version"\) ON "judgment"/,
    );
  });

  it('constrains the outcome to the known values', () => {
    expect(migration).toMatch(/judgment_outcome_check/);
  });
});
