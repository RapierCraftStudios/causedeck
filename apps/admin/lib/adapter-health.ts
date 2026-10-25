// Adapter health for the staff console's Adapters page (#312, part of #27). `AdapterHealthSource` is
// the contract a Court Graph adapter-monitor implements later. Until health is collected, the
// registry-backed source lists `access_mode_registry` rows as `unknown`, never checked.
import type { AccessMode } from '@causedeck/flags/access-mode';

import { adapterRegistry, type StaffActor } from './data/index.ts';

export const ADAPTER_HEALTH_STATUSES = ['healthy', 'degraded', 'down', 'unknown'] as const;
export type AdapterHealthStatus = (typeof ADAPTER_HEALTH_STATUSES)[number];

/** One adapter resource with its access mode and latest health. */
export interface AdapterHealthEntry {
  adapterId: string;
  resource: string;
  mode: AccessMode;
  enabled: boolean;
  status: AdapterHealthStatus;
  /** When health was last checked; `null` when it never was. */
  lastCheckedAt: Date | null;
}

/** Where the Adapters page gets its rows. */
export interface AdapterHealthSource {
  list(): Promise<AdapterHealthEntry[]>;
}

/** Registry rows through the audited data layer; no health data before Court Graph. */
export function registryHealthSource(staff: StaffActor): AdapterHealthSource {
  return {
    async list() {
      const rows = await adapterRegistry(staff);
      return rows.map(({ adapterId, resource, mode, enabled }) => ({
        adapterId,
        resource,
        mode,
        enabled,
        status: 'unknown',
        lastCheckedAt: null,
      }));
    },
  };
}
