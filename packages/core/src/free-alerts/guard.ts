// The free alerts poll guard (#506): what the `system.status.poll` job hands `pollCaseWatches` so a
// free workspace's delegated lookups stay under its monthly fetch cost cap. `admit` refuses a lookup
// the cap cannot take (the watch waits for its next cadence), `fetcherFor` counts each fetch's cost
// as it happens, and `alertNote` is the non-blocking upgrade line on an order alert. Everything is a
// no-op for a paid workspace and while `growth.free-alerts` is off, so a dark flag changes nothing.
import { createHash } from 'node:crypto';

import type { DueWatch, StatusFetcher } from '../case-watch/index.ts';

import {
  admitLookup,
  recordFetchCost,
  flagOf,
  storeOf,
  nowOf,
  type FreeAlertsDeps,
} from './budget.ts';
import { UPGRADE_PROMPTS } from './upgrade.ts';

export interface FreeAlertsPollGuard {
  admit(watch: DueWatch): Promise<boolean>;
  fetcherFor(actor: { workspaceId: string; userId: string }): StatusFetcher;
  alertNote(actor: { workspaceId: string; userId: string }): Promise<string | null>;
}

export function createFreeAlertsPollGuard(
  deps: FreeAlertsDeps,
  fetcher: StatusFetcher,
): FreeAlertsPollGuard {
  return {
    admit: (watch) => admitLookup(deps, watch.workspaceId),
    fetcherFor: (actor) => ({
      async fetchSource(sourceId, url, opts) {
        const fetched = await fetcher.fetchSource(sourceId, url, opts);
        const key = createHash('sha256')
          .update(`${actor.workspaceId}|${sourceId}|${url}|${fetched.provenance.fetchedAt}`)
          .digest('hex');
        // A cost that cannot be written never fails the lookup: the next admit sees the spend it has.
        await recordFetchCost(deps, actor.workspaceId, fetched.provenance.costDollars, key).catch(
          () => 0,
        );
        return fetched;
      },
    }),
    alertNote: async (actor) => {
      if (!(await flagOf(deps)(actor.workspaceId))) return null;
      const limits = await storeOf(deps).limits(actor.workspaceId, nowOf(deps));
      return limits === null ? null : UPGRADE_PROMPTS.order;
    },
  };
}
