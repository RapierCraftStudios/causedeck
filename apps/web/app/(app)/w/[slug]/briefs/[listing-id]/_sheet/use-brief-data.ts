'use client';
// The brief's data seam (#65), like `useCourtDayData`: cache-first from the encrypted store on this
// device. The server-rendered brief wins when there is one; with none (offline) the brief saved by
// the prefetch is shown. Also builds the sheet's view model from a saved brief, whose masthead
// facts come from the saved court day.
import type { Brief, Readiness } from '@causedeck/validators';
import { useEffect, useState } from 'react';

import type { OfflineScope } from '../../../../../../../lib/offline/db.ts';
import { readCachedBrief } from '../../../../../../../lib/offline/prefetch.ts';

import type { SheetViewModel } from './model.ts';

export interface BriefData {
  brief: Brief | null;
  /** The brief shown is the copy saved on this device. */
  fromCache: boolean;
  /** Epoch ms the saved copy was written. */
  savedAt: number | null;
  stale: boolean;
  loading: boolean;
}

export function useBriefData(
  fresh: Brief | null,
  source: { scope: OfflineScope; listingId: string } | undefined,
): BriefData {
  const [cached, setCached] = useState<{ value: Brief; savedAt: number; stale: boolean } | null>(
    null,
  );
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const userId = source?.scope.userId;
  const workspaceId = source?.scope.workspaceId;
  const listingId = source?.listingId;

  useEffect(() => {
    if (fresh !== null || !userId || !workspaceId || !listingId) return;
    const watch = { live: true };
    void readCachedBrief({ userId, workspaceId }, listingId, sessionStorage, Date.now()).then(
      (hit) => {
        if (!watch.live) return;
        setCached(hit);
        setLoadedFor(listingId);
      },
    );
    return () => {
      watch.live = false;
    };
  }, [fresh, userId, workspaceId, listingId]);

  const loading = listingId !== undefined && loadedFor !== listingId;
  if (fresh !== null) {
    return { brief: fresh, fromCache: false, savedAt: null, stale: false, loading: false };
  }
  return {
    brief: cached?.value ?? null,
    fromCache: cached !== null,
    savedAt: cached?.savedAt ?? null,
    stale: cached?.stale ?? false,
    loading,
  };
}

const CONFIRMED = new Set(['confirmed', 'auto_applied', 'corrected']);

/**
 * The four readiness segments of a saved brief, scored as the server does (25 each). Core is server
 * code and stays out of the client bundle, so this mirrors `computeReadiness` without the reasons.
 */
export function savedReadiness(brief: Brief): Readiness {
  const segments = {
    stage_known: brief.stage !== null && brief.stage.text.trim().length > 0,
    last_order_confirmed:
      brief.last_order.length > 0 &&
      brief.last_order.every((l) => CONFIRMED.has(l.confirmation_state)),
    obligations_reconciled: brief.obligations.open.every(
      (o) => !o.overdue && o.owner_member_id !== null,
    ),
    carry_reviewed: brief.carry_reviewed,
  };
  return { score: Object.values(segments).filter(Boolean).length * 25, segments, reasons: [] };
}

/** The sheet's view model for a saved brief: read-only, since nothing is written offline here. */
export function offlineBriefModel(input: {
  slug: string;
  workspaceId: string;
  brief: Brief;
  matterTitle: string;
  caseNo: string | null;
  listDate: string | null;
}): SheetViewModel {
  const { brief } = input;
  return {
    workspaceId: input.workspaceId,
    slug: input.slug,
    brief,
    readiness: savedReadiness(brief),
    masthead: {
      matterTitle: input.matterTitle,
      caseNo: input.caseNo,
      matterHref: `/w/${input.slug}/matters/${brief.matter_id}`,
      listDate: input.listDate,
    },
    members: {},
    canWrite: false,
    printNotes: false,
    staleCleared: false,
    assembledAt: brief.assembled_at,
  };
}
