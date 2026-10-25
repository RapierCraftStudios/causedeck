// Adapter config loader (#372, ADR 0015): the config an adapter parses with is the `active`
// `adapter_version` row for it, or the config bundled with the code when no version is active (an
// empty table on a fresh database). Results are cached per adapter for `ADAPTER_CONFIG_TTL_MS`, so
// another process picks up an activation within a minute without a restart; the process that
// activates invalidates its own cache at once (`activateAdapterVersion`). A row whose config does
// not validate or does not match its checksum is refused, never half-used. `adapter_version` is a
// global table, readable in any scope.
import { db as appDb, type Queryable } from '@causedeck/db';
import { adapterVersion } from '@causedeck/db/schema';
import { and, eq } from 'drizzle-orm';

import { DRT_ADAPTER_ID, DRT_BUNDLED } from '../drt/index.ts';
import { ECHO_ADAPTER_ID, ECHO_BUNDLED } from '../example/echo-adapter.ts';
import { KARNATAKA_HC_ADAPTER_ID, KARNATAKA_HC_BUNDLED } from '../karnataka-hc/index.ts';
import { MADRAS_HC_ADAPTER_ID, MADRAS_HC_BUNDLED } from '../madras-hc/index.ts';
import { NCLT_ADAPTER_ID, NCLT_BUNDLED } from '../nclt-blr/index.ts';

import { configChecksum } from './checksum.ts';
import { AdapterConfigSchema, type AdapterConfig } from './schema.ts';

/** How long a loaded config is served from cache before the table is read again. */
export const ADAPTER_CONFIG_TTL_MS = 60_000;

export interface BundledAdapterConfig {
  version: string;
  config: AdapterConfig;
}

export interface LoadedAdapterConfig extends BundledAdapterConfig {
  /** `db` when an `active` row supplied it, `bundled` for the fallback. */
  source: 'db' | 'bundled';
  checksum: string;
}

export interface AdapterConfigLoader {
  load(adapterId: string): Promise<LoadedAdapterConfig>;
  /** Drop the cached config of `adapterId`, or of every adapter. */
  invalidate(adapterId?: string): void;
}

export interface AdapterConfigLoaderOptions {
  db?: Queryable;
  /** Adapter id -> the config shipped with the code. */
  bundled?: Readonly<Record<string, BundledAdapterConfig>>;
  ttlMs?: number;
  /** Milliseconds clock; tests pass a fake one. */
  now?: () => number;
}

/** A config row that cannot be served: invalid, or edited behind its checksum. */
export class AdapterConfigError extends Error {
  readonly adapterId: string;
  readonly reason: 'invalid-config' | 'checksum-mismatch' | 'no-config';

  constructor(adapterId: string, reason: AdapterConfigError['reason'], message: string) {
    super(message);
    this.name = 'AdapterConfigError';
    this.adapterId = adapterId;
    this.reason = reason;
  }
}

/** The configs bundled with the code, by adapter id. */
export const BUNDLED_ADAPTER_CONFIGS: Readonly<Record<string, BundledAdapterConfig>> = {
  [ECHO_ADAPTER_ID]: ECHO_BUNDLED,
  [MADRAS_HC_ADAPTER_ID]: MADRAS_HC_BUNDLED,
  [KARNATAKA_HC_ADAPTER_ID]: KARNATAKA_HC_BUNDLED,
  [NCLT_ADAPTER_ID]: NCLT_BUNDLED,
  [DRT_ADAPTER_ID]: DRT_BUNDLED,
};

/** Validate a stored config and check it against its checksum. */
export async function verifyStoredConfig(
  adapterId: string,
  row: { version: string; config: unknown; checksum: string },
): Promise<LoadedAdapterConfig> {
  const parsed = AdapterConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    throw new AdapterConfigError(
      adapterId,
      'invalid-config',
      `Adapter ${adapterId} ${row.version}: config does not validate`,
    );
  }
  const checksum = await configChecksum(parsed.data);
  if (checksum !== row.checksum) {
    throw new AdapterConfigError(
      adapterId,
      'checksum-mismatch',
      `Adapter ${adapterId} ${row.version}: config does not match its checksum`,
    );
  }
  return { version: row.version, config: parsed.data, source: 'db', checksum };
}

export function createAdapterConfigLoader({
  db = appDb,
  bundled = BUNDLED_ADAPTER_CONFIGS,
  ttlMs = ADAPTER_CONFIG_TTL_MS,
  now = Date.now,
}: AdapterConfigLoaderOptions = {}): AdapterConfigLoader {
  const cache = new Map<string, { loadedAt: number; value: LoadedAdapterConfig }>();

  async function read(adapterId: string): Promise<LoadedAdapterConfig> {
    const [row] = await db
      .select({
        version: adapterVersion.version,
        config: adapterVersion.config,
        checksum: adapterVersion.checksum,
      })
      .from(adapterVersion)
      .where(and(eq(adapterVersion.adapterId, adapterId), eq(adapterVersion.status, 'active')))
      .limit(1);
    if (row !== undefined) return verifyStoredConfig(adapterId, row);
    const fallback = bundled[adapterId];
    if (fallback === undefined) {
      throw new AdapterConfigError(
        adapterId,
        'no-config',
        `Adapter ${adapterId} has no active version and no bundled config`,
      );
    }
    return { ...fallback, source: 'bundled', checksum: await configChecksum(fallback.config) };
  }

  return {
    async load(adapterId) {
      const cached = cache.get(adapterId);
      if (cached !== undefined && now() - cached.loadedAt < ttlMs) return cached.value;
      const value = await read(adapterId);
      cache.set(adapterId, { loadedAt: now(), value });
      return value;
    },
    invalidate(adapterId) {
      if (adapterId === undefined) cache.clear();
      else cache.delete(adapterId);
    },
  };
}

/** The process-wide loader that `activateAdapterVersion` invalidates by default. */
export const adapterConfigLoader: AdapterConfigLoader = createAdapterConfigLoader();

export const loadAdapterConfig = (adapterId: string): Promise<LoadedAdapterConfig> =>
  adapterConfigLoader.load(adapterId);

export const invalidateAdapterConfig = (adapterId?: string): void => {
  adapterConfigLoader.invalidate(adapterId);
};
