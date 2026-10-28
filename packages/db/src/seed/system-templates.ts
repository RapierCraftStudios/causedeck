// System drafting templates (#76): `template` rows with a null `workspace_id`, written by the owner
// role only (`owner_catalogue`, ADR 0013). The registry lives in @causedeck/drafting, which db may
// not import, so the caller (core's seed script) passes the entries in. Idempotent: an upsert keyed by
// `template_scope_code_uq` that rewrites a row only when its checksum differs, so an unchanged row
// keeps its `updated_at` and a lawyer-set `reviewed_by` survives a re-seed of identical wording.
import { SystemTemplateSeedSchema, type SystemTemplateSeed } from '@causedeck/validators/drafting';
import { sql } from 'drizzle-orm';

import { template } from '../schema/drafting.ts';

import type { SeedDb } from './index.ts';

export interface SystemTemplateSeedResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

export async function seedSystemTemplates(
  db: SeedDb,
  entries: readonly SystemTemplateSeed[],
): Promise<SystemTemplateSeedResult> {
  const parsed = entries.map((e) => SystemTemplateSeedSchema.parse(e));
  const codes = new Set(parsed.map((e) => e.code));
  if (codes.size !== parsed.length) throw new Error('duplicate system template code');
  if (parsed.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const rows = parsed.map((e) => ({
    workspaceId: null,
    code: e.code,
    name: e.name,
    kind: e.kind,
    courtPreset: e.courtPreset,
    blocks: e.blocks,
    locale: e.locale,
    // The column is an integer; the full semantic version is part of the checksum.
    version: Number(e.semver.split('.')[0]),
    checksum: e.checksum,
    reviewedBy: e.reviewedBy,
  }));
  const written = await db
    .insert(template)
    .values(rows)
    .onConflictDoUpdate({
      target: [template.workspaceId, template.code],
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        courtPreset: sql`excluded.court_preset`,
        blocks: sql`excluded.blocks`,
        locale: sql`excluded.locale`,
        version: sql`excluded.version`,
        checksum: sql`excluded.checksum`,
        reviewedBy: sql`excluded.reviewed_by`,
        updatedAt: sql`statement_timestamp()`,
      },
      setWhere: sql`${template.checksum} is distinct from excluded.checksum`,
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  const inserted = written.filter((r) => r.inserted).length;
  return {
    inserted,
    updated: written.length - inserted,
    unchanged: parsed.length - written.length,
  };
}
