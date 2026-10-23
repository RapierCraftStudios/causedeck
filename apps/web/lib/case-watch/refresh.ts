// Refreshing a watched proceeding's court status (#593, D-048 tier 4): the device is tried first
// and the server is the fallback. The lawyer never sees a captcha: the device lookup solves it in
// a worker (solver-client.ts) and either returns the parsed status or null, and null (no
// transport, no solver, an unreadable captcha, an unrecognised page, any error) goes to the server
// action, whose result carries the tier used and the cost. A device-read status is recorded through
// its own action, which validates it again on the server. Client-safe: no server imports.
import type { Result } from '../safe-action.ts';

/** A parsed status as the device read it (validated again by the server action). */
export type DeviceStatus = Record<string, unknown> & { status: 'ok' | 'not_found' | 'unrecognised' };

/** Reads the watch's status page on the device, or null when it cannot. Never throws to the caller. */
export type DeviceLookup = (watchId: string) => Promise<DeviceStatus | null>;

export interface RefreshOutcome {
  outcome: 'changed' | 'unchanged' | 'not_found' | 'unrecognised';
  /** Proposals staged for the changes (shown in the matter's proposals, never applied). */
  proposals: number;
}

export interface ServerRefreshed extends RefreshOutcome {
  tierUsed: string | null;
  costDollars: number;
}

export interface RefreshActions {
  /** `refreshCaseStatusAction`: the server lookup through the fetch layer. */
  server: (raw: unknown) => Promise<Result<ServerRefreshed>>;
  /** `recordDeviceStatusAction`: stores a device-read status. */
  recordDevice: (raw: unknown) => Promise<Result<RefreshOutcome>>;
}

/** Where a refresh was served and what it cost: the provenance of a fallback is visible. */
export type RefreshResult =
  | ({ via: 'device' } & RefreshOutcome)
  | ({ via: 'server' } & ServerRefreshed)
  | { via: 'failed' };

export async function refreshStatus(
  input: { workspaceId: string; watchId: string },
  actions: RefreshActions,
  device?: DeviceLookup,
): Promise<RefreshResult> {
  if (device !== undefined) {
    const read = await device(input.watchId).catch(() => null);
    if (read !== null && read.status !== 'unrecognised') {
      const recorded = await actions.recordDevice({ ...input, status: read });
      if (recorded.ok) return { via: 'device', ...recorded.data };
    }
  }
  const served = await actions.server(input);
  return served.ok ? { via: 'server', ...served.data } : { via: 'failed' };
}
