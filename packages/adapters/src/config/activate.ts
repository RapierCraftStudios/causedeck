// Hot deploy of a versioned adapter config (#372, ADR 0015). `activateAdapterVersion` makes one
// `adapter_version` row the adapter's `active` config without a restart:
// 1. the row's config must validate and match its checksum;
// 2. an adapter built from it must pass the committed golden fixtures (#371), judged as that
//    version; a failing (or empty) suite refuses the activation and writes nothing;
// 3. in one transaction the previous active row is retired and this one activated, with the
//    digest of the fixtures it passed and the verification time;
// 4. the loader cache is invalidated, so this process parses with the new config at once and other
//    processes within the loader TTL.
// Private (lawyer-supplied) fixtures never gate an activation: they are not on a server.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { db as appDb, type Queryable } from '@causedeck/db';
import { adapterVersion } from '@causedeck/db/schema';
import { and, eq, ne } from 'drizzle-orm';

import { createEchoAdapter, ECHO_ADAPTER_ID } from '../example/echo-adapter.ts';
import { FIXTURES_ROOT, runGolden, type GoldenReport } from '../testing/golden.ts';
import type { CourtAdapter } from '../types.ts';

import {
  adapterConfigLoader,
  AdapterConfigError,
  verifyStoredConfig,
  type AdapterConfigLoader,
  type BundledAdapterConfig,
} from './loader.ts';

/** Builds an adapter from a versioned config, by adapter id. */
export type AdapterFactory = (version: BundledAdapterConfig) => CourtAdapter;

export const ADAPTER_FACTORIES: Readonly<Record<string, AdapterFactory>> = {
  [ECHO_ADAPTER_ID]: ({ version, config }) => createEchoAdapter({ version, config }),
};

export type AdapterActivationFailure =
  'not-found' | 'invalid-config' | 'checksum-mismatch' | 'golden-failed' | 'no-factory';

/** An activation was refused; nothing was written. */
export class AdapterActivationError extends Error {
  readonly reason: AdapterActivationFailure;
  readonly adapterId: string;
  readonly version: string;
  /** The golden report when the suite failed. */
  readonly report: GoldenReport | null;

  constructor(
    reason: AdapterActivationFailure,
    adapterId: string,
    version: string,
    report: GoldenReport | null = null,
  ) {
    super(`Activation of ${adapterId} ${version} refused: ${reason}`);
    this.name = 'AdapterActivationError';
    this.reason = reason;
    this.adapterId = adapterId;
    this.version = version;
    this.report = report;
  }
}

/** sha256 over the names and bytes of every file in `fixtures/<adapterId>`, sorted by name. */
export function fixturesDigest(adapterId: string, fixturesRoot: string = FIXTURES_ROOT): string {
  const dir = path.join(fixturesRoot, adapterId);
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    if (!statSync(file).isFile()) continue;
    hash.update(`${name}\u0000`);
    hash.update(readFileSync(file));
    hash.update('\u0000');
  }
  return hash.digest('hex');
}

export interface ActivateAdapterVersionInput {
  adapterId: string;
  version: string;
  /** The staff user who activates it, when there is one. */
  activatedBy?: string | null;
}

export interface ActivateAdapterVersionDeps {
  db?: Queryable;
  loader?: AdapterConfigLoader;
  factories?: Readonly<Record<string, AdapterFactory>>;
  fixturesRoot?: string;
  runGolden?: typeof runGolden;
}

export type AdapterVersionRow = typeof adapterVersion.$inferSelect;

export async function activateAdapterVersion(
  { adapterId, version, activatedBy = null }: ActivateAdapterVersionInput,
  {
    db = appDb,
    loader = adapterConfigLoader,
    factories = ADAPTER_FACTORIES,
    fixturesRoot = FIXTURES_ROOT,
    runGolden: golden = runGolden,
  }: ActivateAdapterVersionDeps = {},
): Promise<AdapterVersionRow> {
  const [row] = await db
    .select()
    .from(adapterVersion)
    .where(and(eq(adapterVersion.adapterId, adapterId), eq(adapterVersion.version, version)))
    .limit(1);
  if (row === undefined) throw new AdapterActivationError('not-found', adapterId, version);

  let stored: BundledAdapterConfig;
  try {
    stored = await verifyStoredConfig(adapterId, row);
  } catch (error) {
    if (error instanceof AdapterConfigError && error.reason !== 'no-config') {
      throw new AdapterActivationError(error.reason, adapterId, version);
    }
    throw error;
  }

  const factory = factories[adapterId];
  if (factory === undefined) throw new AdapterActivationError('no-factory', adapterId, version);
  const report = await golden(adapterId, {
    adapter: factory(stored),
    fixturesRoot,
    privateFixturesDir: null,
    adapterVersion: version,
  });
  if (!report.public.passed || report.public.cases.length === 0) {
    throw new AdapterActivationError('golden-failed', adapterId, version, report);
  }
  const digest = fixturesDigest(adapterId, fixturesRoot);

  const activated = await db.transaction(async (tx) => {
    await tx
      .update(adapterVersion)
      .set({ status: 'retired' })
      .where(
        and(
          eq(adapterVersion.adapterId, adapterId),
          eq(adapterVersion.status, 'active'),
          ne(adapterVersion.id, row.id),
        ),
      );
    const now = new Date();
    const [updated] = await tx
      .update(adapterVersion)
      .set({
        status: 'active',
        activatedAt: now,
        activatedBy,
        lastVerifiedAt: now,
        fixturesDigest: digest,
      })
      .where(eq(adapterVersion.id, row.id))
      .returning();
    if (updated === undefined) throw new AdapterActivationError('not-found', adapterId, version);
    return updated;
  });
  loader.invalidate(adapterId);
  return activated;
}
