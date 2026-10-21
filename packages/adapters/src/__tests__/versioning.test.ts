// Versioned adapter config with hot deploy (#372): one `active` row per adapter, activation gated
// on the golden fixtures (judged as the candidate version), checksum-checked rows, the bundled
// fallback, the 60 s loader cache, and two versions parsing the same list differently in one
// process without a restart.
import { adapterVersion } from '@causedeck/db/schema';
import { withTestDb } from '@causedeck/db/testing';
import type { Transaction } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  configChecksum,
  createEchoAdapter,
  ECHO_ADAPTER_ID,
  ECHO_CONFIG,
  ECHO_FORUM_CODE,
  type AdapterConfig,
  type ParserInput,
} from '../index.ts';
import {
  activateAdapterVersion,
  AdapterActivationError,
  AdapterConfigError,
  ADAPTER_CONFIG_TTL_MS,
  createAdapterConfigLoader,
  fixturesDigest,
} from '../server.ts';

const V1: AdapterConfig = ECHO_CONFIG;
/** 1.1.0 learns a heading 1.0.0 leaves unmapped; no committed fixture prints it. */
const V2: AdapterConfig = {
  ...ECHO_CONFIG,
  stageMap: [
    ...ECHO_CONFIG.stageMap,
    { pattern: '^FOR\\s+FRESH\\s+ADMISSION$', flags: 'i', key: 'fresh_admission' },
  ],
};
/** A regression: admission rows would be keyed differently, so the golden suite fails. */
const BROKEN: AdapterConfig = {
  ...ECHO_CONFIG,
  stageMap: ECHO_CONFIG.stageMap.map((entry) =>
    entry.key === 'admission' ? { ...entry, key: 'admit' } : entry,
  ),
};

const LIST: ParserInput = {
  kind: 'text',
  text: [
    'CAUSE LIST FOR 21.10.2026',
    'COURT HALL 1',
    'FOR FRESH ADMISSION',
    '1. W.P. No. 12345 of 2026  Fictional Petitioner vs Fictional Respondent',
    '',
  ].join('\n'),
  meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: ECHO_FORUM_CODE },
};

async function insertVersion(
  tx: Transaction,
  version: string,
  config: AdapterConfig,
  checksum?: string,
): Promise<void> {
  await tx.insert(adapterVersion).values({
    adapterId: ECHO_ADAPTER_ID,
    version,
    config,
    checksum: checksum ?? (await configChecksum(config)),
  });
}

// The echo adapter's rows only: migrations register other adapters' versions too (0048, #401).
const statusOf = async (tx: Transaction, version: string) =>
  (
    await tx
      .select({ status: adapterVersion.status })
      .from(adapterVersion)
      .where(
        and(eq(adapterVersion.adapterId, ECHO_ADAPTER_ID), eq(adapterVersion.version, version)),
      )
  ).map((row) => row.status);

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(AdapterActivationError);
  return (error as AdapterActivationError).reason;
}

describe('activateAdapterVersion (#372)', () => {
  it('hot-deploys: two versions parse the same list differently without a restart', async () => {
    await withTestDb(async (tx) => {
      await insertVersion(tx, '1.0.0', V1);
      await insertVersion(tx, '1.1.0', V2);
      const loader = createAdapterConfigLoader({ db: tx });

      await activateAdapterVersion(
        { adapterId: ECHO_ADAPTER_ID, version: '1.0.0' },
        { db: tx, loader },
      );
      const before = await createEchoAdapter(await loader.load(ECHO_ADAPTER_ID)).parseCauseList(
        LIST,
      );
      expect(before.adapterVersion).toBe('1.0.0');
      expect(before.rows.map((row) => row.stageNorm)).toEqual([null]);
      expect(before.diagnostics.unmappedHeadings).toEqual(['FOR FRESH ADMISSION']);

      const activated = await activateAdapterVersion(
        { adapterId: ECHO_ADAPTER_ID, version: '1.1.0' },
        { db: tx, loader },
      );
      expect(activated).toMatchObject({ status: 'active', version: '1.1.0' });
      expect(activated.lastVerifiedAt).toBeInstanceOf(Date);
      expect(activated.fixturesDigest).toBe(fixturesDigest(ECHO_ADAPTER_ID));

      // Same loader, same process: activation invalidated the cache.
      const loaded = await loader.load(ECHO_ADAPTER_ID);
      expect(loaded).toMatchObject({ source: 'db', version: '1.1.0' });
      const after = await createEchoAdapter(loaded).parseCauseList(LIST);
      expect(after.adapterVersion).toBe('1.1.0');
      expect(after.rows.map((row) => row.stageNorm)).toEqual(['fresh_admission']);
      expect(after.diagnostics.unmappedHeadings).toEqual([]);
      expect(after).not.toEqual(before);

      expect(await statusOf(tx, '1.0.0')).toEqual(['retired']);
      expect(await statusOf(tx, '1.1.0')).toEqual(['active']);
    });
  });

  it('refuses a version whose golden suite fails and leaves the active one in place', async () => {
    await withTestDb(async (tx) => {
      await insertVersion(tx, '1.0.0', V1);
      await insertVersion(tx, '2.0.0', BROKEN);
      const loader = createAdapterConfigLoader({ db: tx });
      await activateAdapterVersion(
        { adapterId: ECHO_ADAPTER_ID, version: '1.0.0' },
        { db: tx, loader },
      );

      const error = await activateAdapterVersion(
        { adapterId: ECHO_ADAPTER_ID, version: '2.0.0' },
        { db: tx, loader },
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterActivationError);
      expect(error).toMatchObject({ reason: 'golden-failed' });
      expect((error as AdapterActivationError).report?.public.passed).toBe(false);

      expect(await statusOf(tx, '1.0.0')).toEqual(['active']);
      expect(await statusOf(tx, '2.0.0')).toEqual(['draft']);
      expect(await loader.load(ECHO_ADAPTER_ID)).toMatchObject({ version: '1.0.0' });
    });
  });

  it('refuses a missing version, a row edited behind its checksum and an adapter without a factory', async () => {
    await withTestDb(async (tx) => {
      await insertVersion(tx, '1.2.0', V2, await configChecksum(V1));
      expect(
        await refusal(
          activateAdapterVersion({ adapterId: ECHO_ADAPTER_ID, version: '9.9.9' }, { db: tx }),
        ),
      ).toBe('not-found');
      expect(
        await refusal(
          activateAdapterVersion({ adapterId: ECHO_ADAPTER_ID, version: '1.2.0' }, { db: tx }),
        ),
      ).toBe('checksum-mismatch');
      await insertVersion(tx, '1.3.0', V1);
      expect(
        await refusal(
          activateAdapterVersion(
            { adapterId: ECHO_ADAPTER_ID, version: '1.3.0' },
            { db: tx, factories: {} },
          ),
        ),
      ).toBe('no-factory');
      expect(await statusOf(tx, '1.3.0')).toEqual(['draft']);
    });
  });

  it('allows one active row per adapter', async () => {
    await withTestDb(async (tx) => {
      const activatedAt = new Date();
      await tx.insert(adapterVersion).values({
        adapterId: ECHO_ADAPTER_ID,
        version: '1.0.0',
        config: {},
        checksum: 'a'.repeat(64),
        status: 'active',
        activatedAt,
      });
      const error: unknown = await tx
        .transaction((sp) =>
          sp.insert(adapterVersion).values({
            adapterId: ECHO_ADAPTER_ID,
            version: '1.1.0',
            config: {},
            checksum: 'a'.repeat(64),
            status: 'active',
            activatedAt,
          }),
        )
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect((error as { cause?: { code?: string } } | undefined)?.cause?.code).toBe('23505');
    });
  });
});

describe('createAdapterConfigLoader (#372)', () => {
  it('falls back to the bundled config when no version is active', async () => {
    await withTestDb(async (tx) => {
      const loaded = await createAdapterConfigLoader({ db: tx }).load(ECHO_ADAPTER_ID);
      expect(loaded).toMatchObject({ source: 'bundled', version: '1.0.0', config: ECHO_CONFIG });
      expect(loaded.checksum).toBe(await configChecksum(ECHO_CONFIG));
      const error = await createAdapterConfigLoader({ db: tx })
        .load('unknown-adapter')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterConfigError);
      expect(error).toMatchObject({ reason: 'no-config' });
    });
  });

  it('serves the cache for 60 s, then reads the table again', async () => {
    expect(ADAPTER_CONFIG_TTL_MS).toBe(60_000);
    await withTestDb(async (tx) => {
      let clock = 1_000_000;
      const loader = createAdapterConfigLoader({ db: tx, now: () => clock });
      expect(await loader.load(ECHO_ADAPTER_ID)).toMatchObject({ source: 'bundled' });

      // Activated behind the loader's back (another process): not seen until the TTL runs out.
      await insertVersion(tx, '1.1.0', V2);
      await tx
        .update(adapterVersion)
        .set({ status: 'active', activatedAt: new Date() })
        .where(eq(adapterVersion.version, '1.1.0'));
      clock += ADAPTER_CONFIG_TTL_MS - 1;
      expect(await loader.load(ECHO_ADAPTER_ID)).toMatchObject({ source: 'bundled' });
      clock += 1;
      expect(await loader.load(ECHO_ADAPTER_ID)).toMatchObject({ source: 'db', version: '1.1.0' });

      // An explicit invalidate reloads at once.
      await tx
        .update(adapterVersion)
        .set({ status: 'retired' })
        .where(eq(adapterVersion.version, '1.1.0'));
      expect(await loader.load(ECHO_ADAPTER_ID)).toMatchObject({ source: 'db' });
      loader.invalidate(ECHO_ADAPTER_ID);
      expect(await loader.load(ECHO_ADAPTER_ID)).toMatchObject({ source: 'bundled' });
    });
  });

  it('refuses an active row whose config does not match its checksum', async () => {
    await withTestDb(async (tx) => {
      await insertVersion(tx, '1.1.0', V2, await configChecksum(V1));
      await tx
        .update(adapterVersion)
        .set({ status: 'active', activatedAt: new Date() })
        .where(eq(adapterVersion.version, '1.1.0'));
      const error = await createAdapterConfigLoader({ db: tx })
        .load(ECHO_ADAPTER_ID)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterConfigError);
      expect(error).toMatchObject({ reason: 'checksum-mismatch' });
    });
  });
});
