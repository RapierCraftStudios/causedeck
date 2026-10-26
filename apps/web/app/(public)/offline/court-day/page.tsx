'use client';
// The offline court-day shell (#65 part 3). The service worker precaches this public, data-free
// page and answers a failed `/w/<slug>/today`, `/tomorrow` or brief navigation with it, so the URL
// stays the one the person asked for. It finds that URL's workspace from the scope pointer left by
// the prefetch, reads the encrypted store, and renders the board or brief from it. Nothing saved
// (or no session secret) falls back to the branded /offline screen.
import { useTranslations } from 'next-intl';
import { useMemo, useState, useSyncExternalStore } from 'react';

import { OfflineScreen } from '../../../../components/pwa/offline-screen.tsx';
import {
  offlineBriefModel,
  useBriefData,
} from '../../../(app)/w/[slug]/briefs/[listing-id]/_sheet/use-brief-data.ts';
import { BriefSheet } from '../../../(app)/w/[slug]/briefs/[listing-id]/_sheet/brief-sheet.tsx';
import { OfflineBoard } from '../../../(app)/w/[slug]/_court-day/offline-board.tsx';
import { useCourtDayData } from '../../../(app)/w/[slug]/_court-day/use-court-day-data.ts';
import type { BoardData } from '../../../(app)/w/[slug]/_court-day/load-court-day.ts';
import { addDays, courtDate, STALE_AFTER_MS } from '../../../../lib/offline/freshness.ts';
import type { OfflineScope } from '../../../../lib/offline/db.ts';
import { recallScope } from '../../../../lib/offline/prefetch.ts';
import { type OfflineRoute, parseOfflineRoute } from '../../../../lib/pwa/cache-policy.ts';

interface Located {
  route: OfflineRoute;
  scope: OfflineScope;
}

function BoardShell({ located, which }: { located: Located; which: 'today' | 'tomorrow' }) {
  const [now] = useState(() => Date.now());
  const today = courtDate(now);
  const date = which === 'today' ? today : addDays(today, 1);
  const { data, readAt } = useCourtDayData<BoardData | null>(null, null, {
    scope: located.scope,
    date,
  });
  if (!data || !readAt) return <Unsaved kind="courtDay" />;
  const savedAt = readAt.getTime();
  return (
    <OfflineBoard
      slug={located.route.slug}
      board={data}
      savedAt={savedAt}
      stale={now - savedAt > STALE_AFTER_MS}
    />
  );
}

function BriefShell({ located, listingId }: { located: Located; listingId: string }) {
  const t = useTranslations('offline');
  const { brief, loading } = useBriefData(null, { scope: located.scope, listingId });
  if (loading) return null;
  if (!brief) return <Unsaved kind="brief" />;
  return (
    <BriefSheet
      view={offlineBriefModel({
        slug: located.route.slug,
        workspaceId: located.scope.workspaceId,
        brief,
        matterTitle: t('brief.savedFor'),
        caseNo: null,
        listDate: null,
      })}
    />
  );
}

function Unsaved({ kind }: { kind: 'courtDay' | 'brief' }) {
  const t = useTranslations('offline');
  return (
    <>
      <p role="status" className="sr-only">
        {t(`${kind}.unavailable`)}
      </p>
      <OfflineScreen />
    </>
  );
}

const subscribeNothing = () => () => undefined;

export default function OfflineCourtDayPage() {
  // The server (and the first client render) has no location: render nothing until it is known.
  const pathname = useSyncExternalStore(
    subscribeNothing,
    () => window.location.pathname,
    () => '',
  );
  const located = useMemo<Located | null>(() => {
    const route = parseOfflineRoute(pathname);
    const scope = route ? recallScope(localStorage, route.slug) : null;
    return route && scope ? { route, scope } : null;
  }, [pathname]);
  if (pathname === '') return null;
  if (located === null) return <OfflineScreen />;
  return located.route.kind === 'board' ? (
    <BoardShell located={located} which={located.route.which} />
  ) : (
    <BriefShell located={located} listingId={located.route.listingId} />
  );
}
