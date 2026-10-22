'use client';
// The capture inbox (#48, docs/product/09 §1): Needs you, Ready to send and Processing, one tap
// per confirmation. This is the client shell: the segmented control with live counts (a rail from
// 1280 px), the list, the source preview beside it from 768 px, the decisions and what follows
// them (a 7-second Undo toast, a polite live region, focus on the next card) and the page-level
// shortcuts (`u`, `1`/`2`/`3`, `?`). The server renders the page; this shell re-renders when the
// server sends a fresher inbox (polling only while something is processing, `useInboxFeed`).
// Decisions need the server in this issue, so offline switches them off. Nothing here sends, files
// or pays anything.
import { formatDate, isLocale, DEFAULT_LOCALE } from '@causedeck/i18n';
import { OfflineBanner } from '@causedeck/ui/patterns';
import { ShortcutsDialog } from '@causedeck/ui/shortcuts-dialog';
import { toast } from '@causedeck/ui/sonner';
import { Keyboard } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  acceptProposalAction,
  dismissProposalAction,
  editAcceptProposalAction,
  keepAsAttachmentAction,
  markSentAction,
  reassignCaptureAction,
  typeKeyLineAction,
  undoActivityAction,
  type ResolvedView,
} from '../../app/(app)/w/[slug]/inbox/actions.ts';
import { searchMattersAction } from '../../app/(app)/w/[slug]/matters/actions.ts';
import {
  INBOX_SHORTCUT_ROWS,
  inboxShortcut,
  SECTIONS,
  type InboxSection,
} from '../../lib/inbox/shortcuts.ts';
import { useInboxFeed } from '../../lib/inbox/use-inbox-feed.ts';
import {
  countsOf,
  formatLongDate,
  type InboxItemView,
  type InboxView,
} from '../../lib/inbox/view.ts';
import { localCaptures } from '../../lib/inbox/ready-providers.ts';
import type { Result } from '../../lib/safe-action.ts';
import { cn } from '../matters/matter-card.tsx';
import { useCapture } from '../shell/capture-fab.tsx';

import { FirstRun } from './empty-states.tsx';
import { NeedsYouList } from './needs-you-list.tsx';
import { ProcessingList } from './processing-list.tsx';
import type { CardHandlers } from './proposal-card-host.tsx';
import { ReadyToSendList } from './ready-to-send-list.tsx';
import { SourcePreview } from './source-preview.tsx';

/** How long the Undo toast, and the `u` shortcut, stay available. */
export const UNDO_MS = 7000;
/** The card collapse. */
const COLLAPSE_MS = 200;

export interface InboxShellProps {
  view: InboxView;
  workspaceId: string;
  slug: string;
}

const unwrap = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

interface Pending {
  id: string;
  activityId: string;
}

export function InboxShell({ view, workspaceId, slug }: InboxShellProps) {
  const t = useTranslations('inbox');
  const requested = useLocale();
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
  const { openCapture } = useCapture();
  const [section, setSection] = useState<InboxSection>('needsYou');
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [collapsing, setCollapsing] = useState<ReadonlySet<string>>(new Set());
  const [generation, setGeneration] = useState<Readonly<Record<string, number>>>({});
  const liveRef = useRef<HTMLDivElement>(null);
  const undoable = useRef<Pending | null>(null);

  const processing = useMemo(
    () => [
      ...localCaptures().map((row) => ({
        captureId: row.id,
        channel: row.channel,
        status: 'queued' as const,
        createdAt: row.createdAt,
        localOnly: true,
      })),
      ...view.processing,
    ],
    [view.processing],
  );
  const { offline, refresh } = useInboxFeed(processing.length);

  // What is new since the last server render: it fades up and is announced once.
  const [seen, setSeen] = useState(() => ({
    view,
    ids: new Set(view.needsYou.map((item) => item.id)),
    fresh: new Set<string>(),
  }));
  if (seen.view !== view) {
    const fresh = new Set(
      view.needsYou.filter((item) => !seen.ids.has(item.id)).map((item) => item.id),
    );
    setSeen({ view, ids: new Set([...seen.ids, ...view.needsYou.map((item) => item.id)]), fresh });
  }

  const announce = useCallback((message: string) => {
    const node = liveRef.current;
    if (node === null) return;
    node.textContent = '';
    requestAnimationFrame(() => {
      node.textContent = message;
    });
  }, []);

  useEffect(() => {
    if (seen.fresh.size > 0) announce(t('announce.newItems', { count: seen.fresh.size }));
  }, [seen.fresh, announce, t]);

  const items = useMemo(
    () => view.needsYou.filter((item) => !hidden.has(item.id)),
    [view.needsYou, hidden],
  );
  const counts = { ...countsOf(view), needsYou: items.length, processing: processing.length };
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const drop = useCallback((id: string) => {
    setHidden((current) => new Set(current).add(id));
    setCollapsing((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  /** Collapse a card out over 200 ms, then drop it. */
  const collapseOut = useCallback(
    (item: InboxItemView) => {
      setCollapsing((current) => new Set(current).add(item.id));
      setTimeout(() => {
        drop(item.id);
      }, COLLAPSE_MS);
    },
    [drop],
  );

  const restore = useCallback((id: string) => {
    setHidden((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setGeneration((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }, []);

  const undo = useCallback(
    async (pending: Pending) => {
      if (undoable.current?.id === pending.id) undoable.current = null;
      try {
        unwrap(await undoActivityAction({ workspaceId, activityId: pending.activityId }));
      } catch {
        toast.error(t('toast.undoFailed'));
        announce(t('toast.undoFailed'));
        return;
      }
      restore(pending.id);
      toast.success(t('toast.undone'));
      announce(t('toast.undone'));
      refresh();
    },
    [workspaceId, restore, refresh, announce, t],
  );

  /** After a decision that wrote an activity: the 7-second Undo toast and the live region. */
  const afterApplied = useCallback(
    (item: InboxItemView, done: ResolvedView) => {
      const message =
        done.kind === 'next_date' && done.date !== null
          ? t('toast.nextDate', { date: formatDate(done.date, { locale }) })
          : t('toast.done', { kind: t(`card.kind.${done.kind}` as 'card.kind.task') });
      announce(
        done.kind === 'next_date' && done.date !== null
          ? t('announce.confirmedNextDate', { date: formatLongDate(done.date, locale) })
          : t('announce.confirmed'),
      );
      if (done.activityId === null) return;
      const pending: Pending = { id: item.id, activityId: done.activityId };
      undoable.current = pending;
      const clear = () => {
        if (undoable.current?.id === pending.id) undoable.current = null;
      };
      toast.success(message, {
        duration: UNDO_MS,
        action: {
          label: t('toast.undo'),
          onClick: () => {
            void undo(pending);
          },
        },
        onDismiss: clear,
        onAutoClose: clear,
      });
    },
    [announce, locale, t, undo],
  );

  const { fresh } = seen;
  const handlers: CardHandlers = useMemo(
    () => ({
      // The Proposal Card collapses itself; the shell only drops it once it has (`onConfirmed`).
      confirm: async (item) => {
        afterApplied(
          item,
          unwrap(await acceptProposalAction({ workspaceId, proposalId: item.id })),
        );
        refresh();
      },
      editConfirm: async (item, payload) => {
        afterApplied(
          item,
          unwrap(await editAcceptProposalAction({ workspaceId, proposalId: item.id, payload })),
        );
        collapseOut(item);
        refresh();
      },
      dismiss: async (item, suppress) => {
        unwrap(await dismissProposalAction({ workspaceId, proposalId: item.id, suppress }));
        announce(t('announce.dismissed'));
        collapseOut(item);
        refresh();
      },
      chooseDate: async (item, choice, date) => {
        if (choice === 'keep') {
          unwrap(await dismissProposalAction({ workspaceId, proposalId: item.id }));
          announce(t('announce.dismissed'));
        } else if (choice === 'use') {
          afterApplied(
            item,
            unwrap(await acceptProposalAction({ workspaceId, proposalId: item.id })),
          );
        } else {
          afterApplied(
            item,
            unwrap(
              await editAcceptProposalAction({
                workspaceId,
                proposalId: item.id,
                payload: { ...item.payload, date },
              }),
            ),
          );
        }
        collapseOut(item);
        refresh();
      },
      keepAttachment: async (item) => {
        if (item.captureId === null) return;
        unwrap(await keepAsAttachmentAction({ workspaceId, captureId: item.captureId }));
        announce(t('unreadable.kept'));
        collapseOut(item);
        refresh();
      },
      keyLine: async (item, text) => {
        if (item.captureId === null) return;
        unwrap(await typeKeyLineAction({ workspaceId, captureId: item.captureId, text }));
        announce(t('unreadable.saved'));
        collapseOut(item);
        refresh();
      },
      reassign: async (item, matter) => {
        if (item.captureId === null) return;
        unwrap(
          await reassignCaptureAction({
            workspaceId,
            captureId: item.captureId,
            matterId: matter.id,
          }),
        );
        announce(t('reassign.done', { matter: matter.title }));
        collapseOut(item);
        refresh();
      },
      searchMatters: async (query) =>
        unwrap(await searchMattersAction({ workspaceId, q: query })).map((hit) => ({
          id: hit.id,
          title: hit.title,
        })),
      retake: openCapture,
    }),
    [workspaceId, afterApplied, collapseOut, refresh, announce, openCapture, t],
  );

  // `u`, `1`/`2`/`3` and `?`. Capture phase so that `?` is this sheet and not the shell's.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = inboxShortcut(event);
      if (shortcut === null) return;
      if (shortcut.kind === 'help') {
        event.preventDefault();
        event.stopPropagation();
        setHelpOpen((open) => !open);
      } else if (shortcut.kind === 'section') {
        event.preventDefault();
        setSection(shortcut.section);
      } else if (undoable.current !== null) {
        event.preventDefault();
        void undo(undoable.current);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [undo]);

  const shortcutList = INBOX_SHORTCUT_ROWS.map((row) => ({
    keys: row.keys,
    description: t(`shortcuts.${row.id}`),
  }));
  const readOnly = !view.canAct;
  const firstRun =
    items.length === 0 &&
    view.ready.length === 0 &&
    processing.length === 0 &&
    view.channels.some((c) => !c.enabled);

  const tabs = SECTIONS.map((id) => ({ id, label: t(`sections.${id}`), count: counts[id] }));

  return (
    <div className="grid gap-4" data-slot="inbox" lang={locale}>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-ink font-serif text-2xl">{t('title')}</h1>
        <button
          type="button"
          onClick={() => {
            setHelpOpen(true);
          }}
          aria-keyshortcuts="?"
          className="text-ink-muted hover:text-ink flex items-center gap-1 text-xs pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <Keyboard aria-hidden="true" className="size-4" />
          <span className="sr-only md:not-sr-only">{t('shortcuts.open')}</span>
        </button>
      </header>
      {offline ? (
        <OfflineBanner savedAt={new Date()} labels={{ message: () => t('offline.banner') }} />
      ) : null}
      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,420px)_minmax(0,1fr)]">
        <nav
          aria-label={t('sections.label')}
          className="bg-surface sticky top-0 z-10 flex gap-1 py-1 md:col-span-2 xl:col-span-1 xl:flex-col xl:self-start"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-current={section === tab.id ? 'page' : undefined}
              aria-keyshortcuts={String(SECTIONS.indexOf(tab.id) + 1)}
              onClick={() => {
                setSection(tab.id);
                announce(t('announce.section', { section: tab.label, count: tab.count }));
              }}
              className={cn(
                'flex min-h-11 flex-1 items-center justify-between gap-2 rounded-lg px-3 text-sm transition-colors duration-150',
                section === tab.id
                  ? 'bg-surface-sunken text-ink font-medium'
                  : 'text-ink-muted hover:bg-surface-sunken',
              )}
            >
              <span>{tab.label}</span>
              <span className="tabular-nums">{tab.count}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0" data-section={section}>
          {section === 'needsYou' ? (
            firstRun ? (
              <FirstRun channels={view.channels} />
            ) : (
              <NeedsYouList
                items={items}
                locale={locale}
                handlers={handlers}
                offline={offline}
                readOnly={readOnly}
                collapsing={collapsing}
                generation={generation}
                fresh={fresh}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onConfirmed={(item) => {
                  drop(item.id);
                }}
              />
            )
          ) : section === 'ready' ? (
            <ReadyToSendList
              items={view.ready}
              readOnly={readOnly}
              offline={offline}
              onMarkSent={async (item) => {
                unwrap(
                  await markSentAction({
                    workspaceId,
                    providerId: item.providerId,
                    itemId: item.id,
                  }),
                );
                announce(t('ready.marked'));
              }}
            />
          ) : (
            <ProcessingList rows={processing} locale={locale} />
          )}
        </div>
        <SourcePreview item={selected} slug={slug} />
      </div>
      <ShortcutsDialog
        shortcuts={shortcutList}
        open={helpOpen}
        onOpenChange={setHelpOpen}
        enableHotkey={false}
        labels={{ title: t('shortcuts.title'), description: t('shortcuts.description') }}
      />
      <div ref={liveRef} role="status" aria-live="polite" className="sr-only" />
    </div>
  );
}
