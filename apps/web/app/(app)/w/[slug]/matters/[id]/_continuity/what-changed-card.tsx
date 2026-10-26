'use client';
// The what-changed card (#71, R4, R5): records the view (the server debounces to 30 s), and for a
// returning viewer shows what changed since the previous view. The first-ever view shows nothing.
import { ChangeCard } from '@causedeck/ui/patterns';
import type { ChangeSummary } from '@causedeck/validators';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { recordViewAction, whatChangedAction } from './actions.ts';
import { changeGroups, showChangeCard } from './model.ts';

export function WhatChangedCard({
  workspaceId,
  matterId,
  members,
}: {
  workspaceId: string;
  matterId: string;
  members: Record<string, string>;
}) {
  const t = useTranslations('continuity.changes');
  const [summary, setSummary] = useState<ChangeSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const marker = await recordViewAction({ workspaceId, matterId });
      if (!live || !marker.ok || !showChangeCard(marker.data.previous_viewed_at)) return;
      const changed = await whatChangedAction({
        workspaceId,
        matterId,
        since: marker.data.previous_viewed_at,
      });
      if (!live) return;
      if (changed.ok) setSummary(changed.data);
      else setFailed(true);
    })();
    return () => {
      live = false;
    };
  }, [workspaceId, matterId]);

  if (dismissed) return null;
  if (failed)
    return (
      <p role="alert" className="text-sm">
        {t('error')}
      </p>
    );
  if (summary === null) return null;
  const kinds = Object.fromEntries(
    ['order', 'hearing', 'listing', 'next_date', 'obligation', 'document'].map((k) => [
      k,
      t(`kinds.${k}` as 'kinds.order'),
    ]),
  );
  return (
    <ChangeCard
      heading={t('heading', { days: summary.days_ago })}
      groups={changeGroups(summary, kinds, members)}
      emptyLabel={t('empty')}
      dismissLabel={t('dismiss')}
      onDismiss={() => {
        setDismissed(true);
      }}
    />
  );
}
