// The forum catalogue (#34, ADR 0014; PRD CL-1, CL-12): the system `forum` rows (null
// `workspace_id`) for the launch markets, as typed, versioned seed data. Catalogue rows are writable
// by the owner role only (`owner_catalogue`, ADR 0013), so this seed is not in the app-role registry
// (`pnpm db:seed`): `pnpm db:migrate` runs it as the owner after the migrations, on every deploy.
// It is idempotent: an upsert keyed by `forum_scope_code_uq` that leaves unchanged rows (and their
// `updated_at`) alone, a soft-disable of catalogue rows no longer listed (never a delete: proceedings
// reference forums), and the version in `catalogue_meta`. Bump FORUM_CATALOGUE_VERSION with every
// data change. Metadata only: no case types (the adapters own them), halls, rosters or judges.
import { ForumSeedSchema, type ForumSeed } from '@causedeck/validators/forum';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';

import { catalogueMeta } from '../../schema/catalogue-meta.ts';
import { forum } from '../../schema/court.ts';
import type { SeedDb } from '../index.ts';

import { BENGALURU_DISTRICT } from './bengaluru-district.ts';
import { CHENNAI_DISTRICT } from './chennai-district.ts';
import { KARNATAKA_HC } from './karnataka-hc.ts';
import { MADRAS_HC } from './madras-hc.ts';
import { TRIBUNALS } from './tribunals.ts';

export const FORUM_CATALOGUE_VERSION = '2026-10-21.3';

/** The `catalogue_meta` key holding FORUM_CATALOGUE_VERSION. */
export const FORUM_CATALOGUE_META_KEY = 'forum_catalogue';

/** The reason stored on a catalogue row the current catalogue no longer lists. */
export const REMOVED_FROM_CATALOGUE_REASON = 'Removed from the forum catalogue.';

/** Parse every entry and reject duplicate codes. */
export function parseForumCatalogue(entries: readonly ForumSeed[]): readonly ForumSeed[] {
  const parsed = entries.map((entry) => ForumSeedSchema.parse(entry));
  const seen = new Set<string>();
  for (const { code } of parsed) {
    if (seen.has(code)) throw new Error(`duplicate forum catalogue code: ${code}`);
    seen.add(code);
  }
  return parsed;
}

export const FORUM_CATALOGUE: readonly ForumSeed[] = parseForumCatalogue([
  ...MADRAS_HC,
  ...KARNATAKA_HC,
  ...CHENNAI_DISTRICT,
  ...BENGALURU_DISTRICT,
  ...TRIBUNALS,
]);

export interface ForumCatalogueSeedResult {
  version: string;
  inserted: number;
  updated: number;
  disabled: number;
  unchanged: number;
}

export interface SeedForumCatalogueOptions {
  /** Test hook: seed another catalogue (parsed like the real one). */
  catalogue?: readonly ForumSeed[];
  version?: string;
}

/** Upsert the catalogue as the owner role, in one transaction. */
export async function seedForumCatalogue(
  db: SeedDb,
  {
    catalogue = FORUM_CATALOGUE,
    version = FORUM_CATALOGUE_VERSION,
  }: SeedForumCatalogueOptions = {},
): Promise<ForumCatalogueSeedResult> {
  const entries = catalogue === FORUM_CATALOGUE ? catalogue : parseForumCatalogue(catalogue);
  const rows = entries.map((s) => ({
    workspaceId: null,
    code: s.code,
    court: s.court,
    establishment: s.establishment,
    seat: s.seat,
    side: s.side,
    jurisdictionKind: s.jurisdictionKind,
    languageProfile: s.languageProfile,
    adapterId: s.adapterId ?? null,
    adapterLevel: s.adapterLevel,
    config: s.config,
    enabled: s.enabled,
  }));
  return db.transaction(async (tx) => {
    const written =
      rows.length === 0
        ? []
        : await tx
            .insert(forum)
            .values(rows)
            .onConflictDoUpdate({
              target: [forum.workspaceId, forum.code],
              set: {
                court: sql`excluded.court`,
                establishment: sql`excluded.establishment`,
                seat: sql`excluded.seat`,
                side: sql`excluded.side`,
                jurisdictionKind: sql`excluded.jurisdiction_kind`,
                languageProfile: sql`excluded.language_profile`,
                adapterId: sql`excluded.adapter_id`,
                adapterLevel: sql`excluded.adapter_level`,
                config: sql`excluded.config`,
                enabled: sql`excluded.enabled`,
                updatedAt: sql`statement_timestamp()`,
              },
              // Only rows whose data changed: an unchanged row keeps its updated_at.
              setWhere: sql`(${forum.court}, ${forum.establishment}, ${forum.seat}, ${forum.side},
                ${forum.jurisdictionKind}, ${forum.languageProfile}, ${forum.adapterId},
                ${forum.adapterLevel}, ${forum.config}, ${forum.enabled})
                is distinct from (excluded.court, excluded.establishment, excluded.seat,
                excluded.side, excluded.jurisdiction_kind, excluded.language_profile,
                excluded.adapter_id, excluded.adapter_level, excluded.config, excluded.enabled)`,
            })
            .returning({ inserted: sql<boolean>`(xmax = 0)` });
    const inserted = written.filter((r) => r.inserted).length;
    const disabled = await tx
      .update(forum)
      .set({
        enabled: false,
        config: sql`${forum.config} || jsonb_build_object('disabledReason', ${REMOVED_FROM_CATALOGUE_REASON}::text)`,
        updatedAt: sql`statement_timestamp()`,
      })
      .where(
        and(
          isNull(forum.workspaceId),
          eq(forum.enabled, true),
          rows.length === 0
            ? undefined
            : notInArray(
                forum.code,
                rows.map((r) => r.code),
              ),
        ),
      )
      .returning({ id: forum.id });
    await tx
      .insert(catalogueMeta)
      .values({ key: FORUM_CATALOGUE_META_KEY, version })
      .onConflictDoUpdate({
        target: catalogueMeta.key,
        set: { version: sql`excluded.version`, updatedAt: sql`statement_timestamp()` },
        setWhere: sql`${catalogueMeta.version} is distinct from excluded.version`,
      });
    return {
      version,
      inserted,
      updated: written.length - inserted,
      disabled: disabled.length,
      unchanged: rows.length - written.length,
    };
  });
}
