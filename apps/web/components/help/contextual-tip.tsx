'use client';

// Contextual help (#94): a `?` icon on a surface that opens the matching article in the help
// sheet without leaving the page, and the first-run coachmark that points at it. The sheet's
// chunk (articles included) loads on first open.
import { IconButton } from '@causedeck/ui/icon-button';
import { Button } from '@causedeck/ui/button';
import { CircleHelp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useState } from 'react';

import { dismissCoachmarkAction } from '../../app/(app)/w/[slug]/help/actions.ts';
import { articleSlugForSurface, coachmarkKey, type HelpSurface } from '../../lib/help/surfaces.ts';
import type { Role } from '../../lib/workspace-context.ts';

const HelpSheet = lazy(() => import('./help-sheet.tsx').then((m) => ({ default: m.HelpSheet })));

export interface ContextualTipProps {
  surface: HelpSurface;
  workspaceId: string;
  role?: Role | undefined;
}

export function ContextualTip({ surface, workspaceId, role }: ContextualTipProps) {
  const t = useTranslations('help');
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <IconButton
        label={t('tip.label', { surface: t(`surfaces.${surface}`) })}
        variant="ghost"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
      >
        <CircleHelp aria-hidden />
      </IconButton>
      {loaded ? (
        <Suspense fallback={null}>
          <HelpSheet
            open={open}
            onOpenChange={setOpen}
            workspaceId={workspaceId}
            role={role}
            articleSlug={articleSlugForSurface(surface)}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export interface CoachmarkProps {
  surface: Exclude<HelpSurface, 'general'>;
  workspaceId: string;
  /** True when the member already dismissed this surface's coachmark. */
  dismissed: boolean;
}

/** The key `help_state` stores for a surface's coachmark. */

/**
 * Shows once per surface until dismissed: a non-modal note (no focus trap) that Escape or `Got it`
 * closes. The dismissal is saved per member and workspace; a failed save only means it shows again.
 */
export function Coachmark({ surface, workspaceId, dismissed }: CoachmarkProps) {
  const t = useTranslations('help.coachmark');
  const [hidden, setHidden] = useState(dismissed);

  const dismiss = () => {
    setHidden(true);
    void dismissCoachmarkAction({ workspaceId, key: coachmarkKey(surface) });
  };

  useEffect(() => {
    if (hidden) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHidden(true);
        void dismissCoachmarkAction({ workspaceId, key: coachmarkKey(surface) });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [hidden, surface, workspaceId]);

  if (hidden) return null;
  return (
    <aside
      aria-label={t(`${surface}.title`)}
      className="border-line bg-surface-raised flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
    >
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{t(`${surface}.title`)}</p>
        <p>{t(`${surface}.body`)}</p>
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
      </div>
      <Button size="sm" onClick={dismiss}>
        {t('dismiss')}
      </Button>
    </aside>
  );
}
