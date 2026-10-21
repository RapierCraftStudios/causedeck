// The forum catalogue (#34): the data itself (codes, disabled benches, adapters, language profiles,
// hosts, deep links, and nothing about case types or judges), the idempotent owner-role seed (row
// counts, ids and updated_at stable on a re-run; changed rows updated; removed rows soft-disabled;
// the version in catalogue_meta), and RLS on the seeded rows for the app role.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { ForumConfigSchema, LanguageProfileSchema } from '@causedeck/validators/forum';
import { eq, inArray, isNull, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../../client.ts';
import { createOwnerDb } from '../../owner.ts';
import { catalogueMeta } from '../../schema/catalogue-meta.ts';
import { forum } from '../../schema/court.ts';
import { sqlState } from '../../__tests__/rls/fixtures.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../../testing/index.ts';
import { seedTwoTenants } from '../../testing/two-tenants.ts';

import {
  FORUM_CATALOGUE,
  FORUM_CATALOGUE_META_KEY,
  FORUM_CATALOGUE_VERSION,
  REMOVED_FROM_CATALOGUE_REASON,
  seedForumCatalogue,
} from './index.ts';

const ENABLED_CODES = [
  'in.tn.madras-hc.principal.original',
  'in.tn.madras-hc.principal.appellate',
  'in.ka.karnataka-hc.bengaluru',
  'in.tn.chennai.city-civil-court',
  'in.tn.chennai.small-causes',
  'in.tn.chennai.cmm-egmore',
  'in.tn.chennai.family-courts',
  'in.tn.chennai.commercial-court-egmore',
  'in.ka.bengaluru-urban.city-civil-sessions',
  'in.ka.bengaluru-urban.cmm-courts',
  'in.ka.bengaluru-urban.mayo-hall',
  'in.ka.bengaluru-urban.small-causes',
  'in.ka.bengaluru-urban.family-court',
  'in.ka.bengaluru-urban.commercial-courts',
  'in.ka.bengaluru-urban.labour-courts',
  'in.ka.bengaluru-urban.industrial-tribunals',
  'in.nclt.bengaluru',
  'in.drt.bengaluru-1',
  'in.drt.bengaluru-2',
  'in.ka.consumer.bengaluru-urban-district',
  'in.ka.consumer.state-commission',
  'in.ka.rera',
];

const DISABLED_CODES = [
  'in.tn.madras-hc.madurai',
  'in.ka.karnataka-hc.dharwad',
  'in.ka.karnataka-hc.kalaburagi',
];

const byCode = (code: string) => {
  const entry = FORUM_CATALOGUE.find((f) => f.code === code);
  if (entry === undefined) throw new Error(`no catalogue entry ${code}`);
  return entry;
};

/** Every object key and string value in `value`, depth first. */
function* walk(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const item of value) yield* walk(item);
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      yield key;
      yield* walk(item);
    }
  }
}

const allText = [...walk(FORUM_CATALOGUE)];

describe('forum catalogue data (#34)', () => {
  it('lists exactly the enabled launch forums, with stable codes', () => {
    const enabled = FORUM_CATALOGUE.filter((f) => f.enabled).map((f) => f.code);
    expect(enabled.sort()).toEqual([...ENABLED_CODES].sort());
  });

  it('keeps Madurai, Dharwad and Kalaburagi present but disabled, with a reason', () => {
    const disabled = FORUM_CATALOGUE.filter((f) => !f.enabled);
    expect(disabled.map((f) => f.code).sort()).toEqual([...DISABLED_CODES].sort());
    for (const f of disabled) expect(f.config.disabledReason).toMatch(/\S/);
    expect(byCode('in.tn.madras-hc.madurai').config.disabledReason).toMatch(
      /v2.*no ordinary original jurisdiction/i,
    );
  });

  it('gives each forum its adapter id and level', () => {
    for (const code of [
      'in.tn.madras-hc.principal.original',
      'in.tn.madras-hc.principal.appellate',
    ]) {
      expect(byCode(code)).toMatchObject({
        adapterId: 'in.tn.madras-hc.principal',
        adapterLevel: 'A1',
      });
    }
    expect(byCode('in.ka.karnataka-hc.bengaluru')).toMatchObject({
      adapterId: 'in.ka.karnataka-hc.bengaluru',
      adapterLevel: 'A1',
    });
    for (const f of FORUM_CATALOGUE.filter((e) => e.code.startsWith('in.tn.chennai.'))) {
      expect(f).toMatchObject({ adapterId: 'in.tn.chennai.district', adapterLevel: 'A0' });
    }
    for (const f of FORUM_CATALOGUE.filter((e) => e.code.startsWith('in.ka.bengaluru-urban.'))) {
      expect(f).toMatchObject({ adapterId: 'in.ka.bengaluru-urban.district', adapterLevel: 'A0' });
    }
    // NCLT Bengaluru is A1 since its table adapter shipped (#38); the level is data, not code.
    expect(byCode('in.nclt.bengaluru')).toMatchObject({
      adapterId: 'in.nclt.bengaluru',
      adapterLevel: 'A1',
    });
    // The two HC adapters (three forums) and NCLT Bengaluru ship at A1.
    expect(FORUM_CATALOGUE.filter((f) => f.adapterLevel === 'A1').map((f) => f.code)).toHaveLength(
      4,
    );
  });

  it('sets the language profile per forum, and every profile and config validates', () => {
    for (const f of FORUM_CATALOGUE.filter((e) => e.jurisdictionKind === 'high_court')) {
      expect(f.languageProfile.primary).toBe('en');
    }
    for (const f of FORUM_CATALOGUE.filter((e) => e.code.startsWith('in.tn.chennai.'))) {
      expect(f.languageProfile).toEqual({ primary: 'ta', secondary: ['en'], ocr: ['ta', 'en'] });
    }
    for (const f of FORUM_CATALOGUE.filter((e) => e.code.startsWith('in.ka.bengaluru-urban.'))) {
      expect(f.languageProfile).toEqual({ primary: 'en', secondary: ['kn'], ocr: ['kn', 'en'] });
    }
    expect(byCode('in.nclt.bengaluru').languageProfile).toEqual({ primary: 'en' });
    for (const f of FORUM_CATALOGUE) {
      expect(LanguageProfileSchema.safeParse(f.languageProfile).success, f.code).toBe(true);
      expect(ForumConfigSchema.safeParse(f.config).success, f.code).toBe(true);
    }
  });

  it('keeps hosts as an ordered list: Madras HC lists all four hostnames', () => {
    expect(byCode('in.tn.madras-hc.principal.original').config.hosts).toEqual([
      'hcmadras.tn.gov.in',
      'mhc.tn.gov.in',
      'madrashighcourt.tn.gov.in',
      'judgments.ecourts.gov.in',
    ]);
    for (const f of FORUM_CATALOGUE) expect(f.config.hosts.length, f.code).toBeGreaterThan(0);
  });

  it('covers the verified HC pages with deep-link templates', () => {
    expect(
      Object.keys(byCode('in.tn.madras-hc.principal.appellate').config.deepLinks).sort(),
    ).toEqual(
      [
        'case_status',
        'cause_list',
        'display_board',
        'e_copy',
        'orders',
        'sitting_arrangements',
      ].sort(),
    );
    expect(Object.keys(byCode('in.ka.karnataka-hc.bengaluru').config.deepLinks).sort()).toEqual(
      ['case_status', 'cause_list', 'display_board', 'orders'].sort(),
    );
    expect(byCode('in.nclt.bengaluru').config.deepLinks.cause_list).toBe('all-cause-list');
  });

  it('has no embeddable entry: no `embed` key anywhere', () => {
    expect(allText).not.toContain('embed');
    expect(allText.filter((t) => /embed|iframe/i.test(t))).toEqual([]);
  });

  it('contains no case-type data (the adapters own it, #36 and #37)', () => {
    expect(allText.filter((t) => /case[\s_-]?types?/i.test(t))).toEqual([]);
  });

  it('mentions no ratings, rankings or judge information', () => {
    const banned = /\b(judges?|justices?|coram|hon'?ble|ratings?|rankings?|ranked|rank|scores?)\b/i;
    expect(allText.filter((t) => banned.test(t))).toEqual([]);
  });
});

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));

beforeAll(async () => {
  // Committed, as `pnpm db:migrate` leaves it: the app-role transactions below must see the rows.
  await seedForumCatalogue(owner);
});

afterAll(async () => {
  await owner.$client.end();
});

/** Run `fn` as the owner in a transaction that is always rolled back. */
async function ownerRolledBack(fn: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await owner.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

async function catalogueRows(tx: Transaction) {
  return tx
    .select({
      id: forum.id,
      code: forum.code,
      court: forum.court,
      enabled: forum.enabled,
      config: forum.config,
      updatedAt: forum.updatedAt,
    })
    .from(forum)
    .where(
      inArray(
        forum.code,
        FORUM_CATALOGUE.map((f) => f.code),
      ),
    )
    .orderBy(forum.code);
}

describe('seedForumCatalogue (#34)', () => {
  it('is idempotent: a re-run keeps row counts, ids and updated_at', async () => {
    await ownerRolledBack(async (tx) => {
      await seedForumCatalogue(tx);
      const first = await catalogueRows(tx);
      const total = await tx.$count(forum, isNull(forum.workspaceId));
      const again = await seedForumCatalogue(tx);
      expect(again).toMatchObject({ inserted: 0, updated: 0, disabled: 0 });
      expect(again.unchanged).toBe(FORUM_CATALOGUE.length);
      expect(await catalogueRows(tx)).toEqual(first);
      expect(await tx.$count(forum, isNull(forum.workspaceId))).toBe(total);
      expect(first).toHaveLength(FORUM_CATALOGUE.length);
    });
  });

  it('updates a changed row only, and soft-disables a removed row', async () => {
    await ownerRolledBack(async (tx) => {
      await seedForumCatalogue(tx);
      const before = await catalogueRows(tx);
      const [changed, removed] = ['in.ka.rera', 'in.drt.bengaluru-2'];
      const edited = FORUM_CATALOGUE.filter((f) => f.code !== removed).map((f) =>
        f.code === changed ? { ...f, court: 'RERA Karnataka (renamed)' } : f,
      );
      const result = await seedForumCatalogue(tx, { catalogue: edited, version: 'test.2' });
      expect(result).toMatchObject({ inserted: 0, updated: 1, version: 'test.2' });
      expect(result.disabled).toBeGreaterThanOrEqual(1);
      const after = await catalogueRows(tx);
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
      for (const row of after) {
        const old = before.find((r) => r.id === row.id);
        if (row.code === changed) {
          expect(row.court).toBe('RERA Karnataka (renamed)');
          expect(row.updatedAt.getTime()).toBeGreaterThan(old?.updatedAt.getTime() ?? Infinity);
        } else if (row.code === removed) {
          expect(row.enabled).toBe(false);
          expect(row.config).toMatchObject({ disabledReason: REMOVED_FROM_CATALOGUE_REASON });
        } else {
          expect(row).toEqual(old);
        }
      }
      const [meta] = await tx
        .select()
        .from(catalogueMeta)
        .where(eq(catalogueMeta.key, FORUM_CATALOGUE_META_KEY));
      expect(meta?.version).toBe('test.2');
      // Re-listing the row enables it again with the catalogue's config.
      await seedForumCatalogue(tx);
      const [back] = await tx.select().from(forum).where(eq(forum.code, removed));
      expect(back?.enabled).toBe(true);
      expect(back?.config).not.toHaveProperty('disabledReason');
    });
  });

  it('records FORUM_CATALOGUE_VERSION in catalogue_meta', async () => {
    const [meta] = await owner
      .select()
      .from(catalogueMeta)
      .where(eq(catalogueMeta.key, FORUM_CATALOGUE_META_KEY));
    expect(meta?.version).toBe(FORUM_CATALOGUE_VERSION);
  });

  it('seeded rows are readable from every workspace and read-only for the app role', async () => {
    const code = 'in.tn.madras-hc.principal.original';
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seedTwoTenants(tx);
      for (const [ws, uid] of [
        [a.id, ua],
        [b.id, ub],
      ] as const) {
        await inWorkspace(
          tx,
          ws,
          async (scoped) => {
            const rows = await scoped
              .select({ id: forum.id, enabled: forum.enabled })
              .from(forum)
              .where(eq(forum.code, code));
            expect(rows).toEqual([{ id: expect.any(String) as string, enabled: true }]);
            expect(
              await sqlState(
                scoped.transaction((sp) =>
                  sp.insert(forum).values({
                    workspaceId: null,
                    code: `in.test.${randomUUID().slice(0, 8)}`,
                    court: 'Injected',
                    jurisdictionKind: 'other',
                  }),
                ),
              ),
            ).toBe('42501');
            const updated = await scoped
              .update(forum)
              .set({ court: 'Hijacked' })
              .where(eq(forum.code, code))
              .returning({ id: forum.id });
            expect(updated).toEqual([]);
            const deleted = await scoped
              .delete(forum)
              .where(eq(forum.code, code))
              .returning({ id: forum.id });
            expect(deleted).toEqual([]);
            expect(
              await sqlState(
                scoped.transaction((sp) => sp.update(catalogueMeta).set({ version: 'hijacked' })),
              ),
            ).toBe('42501');
          },
          uid,
        );
      }
    });
    const [row] = await owner
      .select({ court: forum.court })
      .from(forum)
      .where(eq(forum.code, code));
    expect(row?.court).toBe('Madras High Court');
  });
});
