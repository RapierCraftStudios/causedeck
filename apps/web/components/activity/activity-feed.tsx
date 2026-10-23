'use client';
// The automation activity feed (#49; docs/product/09 §5-§6): what CauseDeck did, newest first,
// grouped by day, with filters in the URL, keyset paging of 50, a 7-day Undo that previews its
// cascade, "Undo everything from this capture", "Moved to wrong matter? Reassign" and export.
// Undo and reassign are the engine's (#47); this only calls them through server actions.
//
// Layout: 360 px single column of stacked cards with a full-width Undo; 768 px inline Undo at the
// right and a collapsible filter bar; 1280 px a two-column grid with a sticky filter rail.
// Keys (not while typing, not under a dialog): `j`/`k` move, `Enter` expands, `u` opens the undo
// preview of the focused item, `/` searches, `?` lists them. Results are announced in a polite live
// region; focus returns to the item when a dialog closes. Offline, the page already shown stays and
// Undo and export pause with the reason. A viewer reads but cannot undo; a clerk sees the kinds a
// clerk may act on (core filters them).
import type { ActivityPage, ActivityView } from '@causedeck/core/automation';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { isTypingTarget } from '@causedeck/ui/hooks';
import { ShortcutsDialog, type Shortcut } from '@causedeck/ui/shortcuts-dialog';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { CircleAlert, History, WifiOff } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { UndoOutcome, UndoPreviewResult } from '../../app/(app)/w/[slug]/activity/actions.ts';
import type { MatterSearchHit } from '../../app/(app)/w/[slug]/matters/actions.ts';
import type { Result } from '../../lib/safe-action.ts';

import { ActivityDayGroup, dayOf, groupByDay } from './activity-day-group.tsx';
import { ActivityFilters } from './activity-filters.tsx';
import { ActivityItem } from './activity-item.tsx';
import { ExportMenu } from './export-menu.tsx';
import { feedFilterQuery, hasFeedFilters, type FeedFilters } from './feed-params.ts';
import { ReassignDialog } from './reassign-dialog.tsx';
import { UndoDialog, type UndoTarget } from './undo-dialog.tsx';

export interface FeedActions {
  loadMore: (input: {
    workspaceId: string;
    cursor: string;
    level?: 'L1' | 'L2' | 'L3' | 'L4';
    kind?: string;
    matterId?: string;
    captureId?: string;
    from?: string;
    to?: string;
    q?: string;
  }) => Promise<Result<ActivityPage>>;
  preview: (input: {
    workspaceId: string;
    activityId: string;
  }) => Promise<Result<UndoPreviewResult>>;
  undo: (input: { workspaceId: string; activityId: string }) => Promise<Result<UndoOutcome>>;
  undoCapture: (input: { workspaceId: string; captureId: string }) => Promise<Result<UndoOutcome>>;
  reassign: (input: {
    workspaceId: string;
    captureId: string;
    matterId: string;
  }) => Promise<Result<unknown>>;
  searchMatters: (input: { workspaceId: string; q: string }) => Promise<Result<MatterSearchHit[]>>;
}

export interface ActivityFeedProps {
  workspace: { id: string; slug: string };
  initialPage: ActivityPage;
  members: readonly { userId: string; name: string }[];
  currentUserId: string;
  role: string;
  filters: FeedFilters;
  actions: FeedActions;
  /** The server's clock for this render (ISO), so "Today" and the undo countdown agree. */
  nowIso: string;
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function ActivityFeed({
  workspace,
  initialPage,
  members,
  currentUserId,
  role,
  filters,
  actions,
  nowIso,
}: ActivityFeedProps) {
  const t = useTranslations('activity');
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnline();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const names = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);

  const [items, setItems] = useState<ActivityView[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [undone, setUndone] = useState<ReadonlyMap<string, { by: string | null; at: string }>>(
    new Map(),
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [focusedId, setFocusedId] = useState<string | undefined>(initialPage.items[0]?.id);
  const [undoTarget, setUndoTarget] = useState<UndoTarget | null>(null);
  const [reassignCapture, setReassignCapture] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const dialogOpen = undoTarget !== null || reassignCapture !== null || shortcutsOpen;
  const canUndo = initialPage.canUndo;

  const focusItem = useCallback((id: string | undefined) => {
    if (id === undefined) return;
    setFocusedId(id);
    itemRefs.current.get(id)?.focus();
  }, []);

  const returnFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      focusItem(focusedId);
    },
    [focusItem, focusedId],
  );

  const openUndo = useCallback((item: ActivityView) => {
    setFocusedId(item.id);
    setUndoTarget({ kind: 'activity', item });
  }, []);

  // Keys run in the capture phase so the app shell's own `/` and `?` shortcuts do not also fire.
  useEffect(() => {
    if (dialogOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const index = items.findIndex((item) => item.id === focusedId);
      const handled = (): void => {
        event.preventDefault();
      };
      if (event.key === 'j') {
        handled();
        focusItem(items[Math.min(items.length - 1, index + 1)]?.id);
      } else if (event.key === 'k') {
        handled();
        focusItem(items[Math.max(0, index - 1)]?.id);
      } else if (event.key === 'u') {
        const item = items[index];
        if (item?.undoable && canUndo && online && !undone.has(item.id)) {
          handled();
          openUndo(item);
        }
      } else if (event.key === '/') {
        handled();
        searchRef.current?.focus();
      } else if (event.key === '?') {
        handled();
        setShortcutsOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [dialogOpen, items, focusedId, focusItem, canUndo, online, undone, openUndo]);

  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setLoadFailed(false);
    try {
      const result = await actions.loadMore({
        workspaceId: workspace.id,
        cursor: nextCursor,
        ...(filters.level === undefined ? {} : { level: filters.level }),
        ...(filters.kind === undefined ? {} : { kind: filters.kind }),
        ...(filters.matter === undefined ? {} : { matterId: filters.matter }),
        ...(filters.capture === undefined ? {} : { captureId: filters.capture }),
        ...(filters.from === undefined
          ? {}
          : { from: new Date(`${filters.from}T00:00:00+05:30`).toISOString() }),
        ...(filters.to === undefined
          ? {}
          : { to: new Date(Date.parse(`${filters.to}T00:00:00+05:30`) + DAY_MS).toISOString() }),
        ...(filters.q === undefined ? {} : { q: filters.q }),
      });
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      setItems((current) => [...current, ...result.data.items]);
      setNextCursor(result.data.nextCursor);
      setAnnouncement(t('feed.loaded', { count: result.data.items.length }));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const onUndone = (outcome: Extract<UndoOutcome, { status: 'undone' }>) => {
    const at = new Date().toISOString();
    setUndone((current) => {
      const next = new Map(current);
      for (const entry of outcome.undone) next.set(entry.activityId, { by: currentUserId, at });
      return next;
    });
    setAnnouncement(
      [
        t('announce.undone', { count: outcome.undone.length }),
        outcome.skipped.length > 0
          ? t('undoDialog.skipped', { count: outcome.skipped.length })
          : '',
      ]
        .filter(Boolean)
        .join('. '),
    );
    setUndoTarget(null);
    requestAnimationFrame(() => {
      focusItem(focusedId);
    });
  };

  const openCapture = (captureId: string) => {
    const query = feedFilterQuery({ capture: captureId });
    router.replace(`${pathname}?${query}`, { scroll: false });
  };

  const today = dayOf(nowIso);
  const yesterday = dayOf(new Date(now.getTime() - DAY_MS).toISOString());
  const groups = groupByDay(items);
  const captureItems =
    filters.capture === undefined ? [] : items.filter((i) => i.captureId === filters.capture);
  const anyUndoable = captureItems.some((i) => i.undoable && !undone.has(i.id));

  const shortcuts: Shortcut[] = [
    { keys: 'j', description: t('shortcuts.next') },
    { keys: 'k', description: t('shortcuts.prev') },
    { keys: 'enter', description: t('shortcuts.expand') },
    { keys: 'u', description: t('shortcuts.undo') },
    { keys: '/', description: t('shortcuts.search') },
    { keys: '?', description: t('shortcuts.help') },
  ];

  return (
    <div
      data-slot="activity-feed"
      className="flex flex-col gap-4 xl:grid xl:grid-cols-[260px_minmax(0,720px)] xl:items-start xl:gap-8"
    >
      <aside aria-label={t('filters.label')}>
        <ActivityFilters
          workspaceId={workspace.id}
          filters={filters}
          disabled={!online}
          searchRef={searchRef}
          searchMatters={actions.searchMatters}
        />
      </aside>
      <div className="flex min-w-0 flex-col gap-4">
        <div role="status" aria-live="polite" className="sr-only" data-slot="activity-live">
          {announcement}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-keyshortcuts="?"
            onClick={() => {
              setShortcutsOpen(true);
            }}
          >
            {t('feed.shortcutsButton')}
          </Button>
          <ExportMenu
            workspaceId={workspace.id}
            from={filters.from}
            to={filters.to}
            disabled={!online}
            now={now}
          />
        </div>
        {online ? null : (
          <p
            data-slot="activity-offline"
            className="border-line bg-surface-sunken text-ink flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <WifiOff aria-hidden="true" className="size-4" />
            {t('states.offline')}
          </p>
        )}
        {!canUndo ? (
          <p data-slot="activity-view-only" className="text-ink-muted text-sm">
            {t('feed.viewOnly')}
          </p>
        ) : role === 'clerk' ? (
          <p className="text-ink-muted text-sm">{t('feed.clerkNote')}</p>
        ) : null}
        {filters.capture === undefined ? null : (
          <section
            data-slot="activity-capture"
            aria-label={t('feed.captureBanner')}
            className="border-line bg-surface-sunken flex flex-wrap items-center gap-2 rounded-md border p-3"
          >
            <p className="text-sm font-medium">{t('feed.captureBanner')}</p>
            <div className="flex flex-wrap gap-2">
              {canUndo ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!online || !anyUndoable}
                    onClick={() => {
                      setUndoTarget({
                        kind: 'capture',
                        captureId: filters.capture as string,
                        items: captureItems,
                      });
                    }}
                  >
                    {t('item.bulkUndo')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!online}
                    onClick={() => {
                      setReassignCapture(filters.capture as string);
                    }}
                  >
                    {t('item.reassign')}
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  router.replace(pathname, { scroll: false });
                }}
              >
                {t('feed.captureClear')}
              </Button>
            </div>
          </section>
        )}
        {items.length === 0 ? (
          hasFeedFilters(filters) ? (
            <EmptyState
              icon={<History />}
              title={t('states.filteredEmpty')}
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    router.replace(pathname, { scroll: false });
                  }}
                >
                  {t('states.clear')}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<History />} title={t('states.empty')} />
          )
        ) : (
          <div role="region" aria-label={t('feed.label')} className="flex flex-col gap-4">
            {groups.map((group) => (
              <ActivityDayGroup key={group.day} day={group.day} today={today} yesterday={yesterday}>
                {group.items.map((item) => (
                  <ActivityItem
                    key={item.id}
                    ref={(element) => {
                      if (element === null) itemRefs.current.delete(item.id);
                      else itemRefs.current.set(item.id, element);
                    }}
                    item={item}
                    workspaceSlug={workspace.slug}
                    now={now}
                    names={names}
                    canUndo={canUndo}
                    offline={!online}
                    focused={focusedId === item.id}
                    undone={undone.get(item.id)}
                    onUndo={openUndo}
                    onOpenCapture={openCapture}
                    onFocus={() => {
                      setFocusedId(item.id);
                    }}
                  />
                ))}
              </ActivityDayGroup>
            ))}
          </div>
        )}
        {loadFailed ? (
          <p role="alert" className="text-danger text-sm">
            {t('states.errorHint')}
          </p>
        ) : null}
        {nextCursor === null ? null : (
          <Button
            type="button"
            variant="secondary"
            disabled={loadingMore || !online}
            onClick={() => {
              void loadMore();
            }}
          >
            {loadingMore ? t('feed.loadingMore') : t('feed.loadMore')}
          </Button>
        )}
      </div>
      {undoTarget === null ? null : (
        <UndoDialog
          workspaceId={workspace.id}
          workspaceSlug={workspace.slug}
          target={undoTarget}
          actions={actions}
          onUndone={onUndone}
          onClose={() => {
            setUndoTarget(null);
          }}
          onCloseAutoFocus={returnFocus}
        />
      )}
      {reassignCapture === null ? null : (
        <ReassignDialog
          workspaceId={workspace.id}
          captureId={reassignCapture}
          actions={actions}
          onReassigned={() => {
            setReassignCapture(null);
            setAnnouncement(t('announce.reassigned'));
            router.refresh();
          }}
          onClose={() => {
            setReassignCapture(null);
          }}
          onCloseAutoFocus={returnFocus}
        />
      )}
      <ShortcutsDialog
        shortcuts={shortcuts}
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        enableHotkey={false}
        labels={{ title: t('shortcuts.title'), close: t('shortcuts.close') }}
      />
    </div>
  );
}

/** Placeholder rows while the feed loads: icon, two text lines and a button. */
export function ActivitySkeleton() {
  const t = useTranslations('activity.states');
  return (
    <SkeletonGroup
      aria-label={t('loading')}
      data-slot="activity-skeleton"
      className="flex flex-col gap-2"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="border-line flex gap-3 rounded-lg border p-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-8 w-20 max-md:hidden" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** The feed could not load: what happened, that nothing changed, and `Try again`. */
export function ActivityError() {
  const t = useTranslations('activity.states');
  const router = useRouter();
  return (
    <div
      role="alert"
      data-slot="activity-error"
      className="border-danger bg-danger-soft flex flex-col items-center gap-3 rounded-xl border px-6 py-8 text-center"
    >
      <CircleAlert aria-hidden="true" className="text-danger size-5" />
      <p className="text-ink font-medium">{t('error')}</p>
      <p className="text-ink-muted text-sm">{t('errorHint')}</p>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          router.refresh();
        }}
      >
        {t('retry')}
      </Button>
    </div>
  );
}

/** Permission denied: no access to the feed at all. */
export function ActivityDenied() {
  const t = useTranslations('activity.states');
  return <EmptyState data-slot="activity-denied" title={t('denied')} />;
}
