// The chamber's saved column mapping for the spreadsheet importer (#778, deferred from #687): field
// -> header text, one per workspace. Matching is by header text, so it survives a re-ordered sheet;
// `autoMapColumns(header, saved)` lets it override the guess. Only known fields and non-empty
// headers are stored.
import { IMPORT_FIELDS, type ColumnMapping, type ImportField } from '@causedeck/capture';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { eq } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';

import type { ProfileScope } from './profile.ts';

const MAX_HEADER_LENGTH = 200;

function normalise(mapping: ColumnMapping): ColumnMapping {
  const known = new Set<string>(IMPORT_FIELDS);
  const out: ColumnMapping = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (!known.has(field)) throw invalid(`Unknown import field: ${field}`);
    if (typeof header !== 'string') throw invalid('A mapped header must be text');
    const text = header.trim();
    if (text === '') continue;
    if (text.length > MAX_HEADER_LENGTH) throw invalid('A mapped header is too long');
    out[field as ImportField] = text;
  }
  return out;
}

/** The workspace's saved mapping; empty when none was saved. */
export async function getChamberMapping(
  db: Database | Transaction,
  scope: ProfileScope,
): Promise<ColumnMapping> {
  const { importColumnMapping } = schema;
  const [row] = await withWorkspace(db, scope, (tx) =>
    tx
      .select({ mapping: importColumnMapping.mapping })
      .from(importColumnMapping)
      .where(eq(importColumnMapping.workspaceId, scope.workspaceId)),
  );
  return row === undefined ? {} : normalise(row.mapping);
}

/** Replace the workspace's saved mapping; returns what was stored. */
export async function saveChamberMapping(
  db: Database | Transaction,
  scope: ProfileScope,
  mapping: ColumnMapping,
): Promise<ColumnMapping> {
  const stored = normalise(mapping);
  const { importColumnMapping } = schema;
  await withWorkspace(db, scope, (tx) =>
    tx
      .insert(importColumnMapping)
      .values({ workspaceId: scope.workspaceId, mapping: stored, updatedBy: scope.userId })
      .onConflictDoUpdate({
        target: importColumnMapping.workspaceId,
        set: { mapping: stored, updatedBy: scope.userId, updatedAt: new Date() },
      }),
  );
  return stored;
}
