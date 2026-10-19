'use client';
// The Activity page's security and audit tab (#232, #26 part 6): workspace audit events as cards
// below 768 px and a table above, newest first. Each row reads as a sentence (`Asha Rao changed
// Meera's role to Clerk`), then who and when; the outcome is an icon plus text and denied rows
// carry the warning tint. Owners also see the (truncated) IP. The table is the ui `DataTable` (row
// activation, roving focus, cards via `mobileRender` as `ActivityItem`s with the outcome trailing).
// `J`/`K` move the focused row, `Enter` opens the event drawer (lazy), `E` opens the export dialog
// (lazy). More events load by cursor.
//
// States: loading (`AuditSkeleton`), empty, error (`AuditError`, Try again), permission-denied
// (`AuditDenied`) and offline (the page already shown stays, read-only: filters, export and load
// more pause). Filters live in the URL (`filters.tsx`), so a reload or a shared link keeps them.
import { Alert } from '@causedeck/ui/alert';
import { Badge, type BadgeTone } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { useHotkey, useMediaQuery, useReducedMotion } from '@causedeck/ui/hooks';
import { ActivityItem } from '@causedeck/ui/patterns';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import {
  createDataTableColumnHelper,
  DATA_TABLE_MOBILE_QUERY,
  DataTable,
} from '@causedeck/ui/data-table';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Flag,
  History,
  ShieldAlert,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useSyncExternalStore } from 'react';

import type { Result } from '../../../../../lib/safe-action.ts';

import type { ChainStatus } from './actions.ts';
import { ExportButton } from './export-button.tsx';
import { filterBounds, type AuditFilterValues } from './filter-params.ts';
import { AuditFilters, type AuditMember } from './filters.tsx';

const EventDrawer = dynamic(() => import('./event-drawer.tsx').then((m) => m.EventDrawer), {
  ssr: false,
});

export type AuditOutcome = 'success' | 'denied' | 'error';
export type AuditActorKind = 'user' | 'staff' | 'system' | 'api';

/** One event as the feed gets it (`AuditEventView` from `@causedeck/core/audit`). */
export interface AuditFeedEvent {
  id: string;
  /** ISO 8601 UTC with microseconds. */
  createdAt: string;
  actorUserId: string | null;
  actorKind: AuditActorKind;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  outcome: AuditOutcome;
  requestId: string | null;
  userAgentHash: string | null;
  metadata: Record<string, unknown>;
  hash: string;
  /** Owners only: the IP truncated for display (`/24`). */
  ip?: string | null;
}

export interface AuditFeedPage {
  events: AuditFeedEvent[];
  nextCursor: string | null;
}

export interface AuditFeedActions {
  loadMore: (input: {
    workspaceId: string;
    cursor: string;
    from?: string;
    to?: string;
    actorUserId?: string;
    actionGroup?: string;
  }) => Promise<Result<AuditFeedPage>>;
  verifyEvent: (input: {
    workspaceId: string;
    eventId: string;
    createdAt: string;
  }) => Promise<Result<ChainStatus>>;
}

/** An event with its display strings resolved. */
export interface AuditRow {
  event: AuditFeedEvent;
  sentence: string;
  actorName: string;
  targetName: string | null;
  when: string;
  icon: LucideIcon;
}

const OUTCOME: Record<AuditOutcome, { tone: BadgeTone; icon: LucideIcon }> = {
  success: { tone: 'success', icon: CircleCheck },
  denied: { tone: 'warning', icon: ShieldAlert },
  error: { tone: 'danger', icon: CircleX },
};

const ROLES = ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const;
type RoleName = (typeof ROLES)[number];

function isRoleName(value: unknown): value is RoleName {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

function iconFor(action: string): LucideIcon {
  if (action.startsWith('member.')) return UserCog;
  if (action.startsWith('flag.')) return Flag;
  if (action.startsWith('audit.')) return History;
  return CircleAlert;
}

/** Joins class names, skipping falsy parts. */
function cn(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
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

/** Resolve sentences, names and times for display. */
function useRows(events: readonly AuditFeedEvent[], members: readonly AuditMember[]): AuditRow[] {
  const t = useTranslations('audit');
  const tRoles = useTranslations('members.roles');
  const format = useFormatter();
  const names = new Map<string, string>();
  for (const m of members) {
    names.set(m.userId, m.name);
    names.set(m.memberId, m.name);
  }

  return events.map((event) => {
    const actorName =
      event.actorKind === 'user'
        ? ((event.actorUserId && names.get(event.actorUserId)) ?? t('actor.unknown'))
        : t(`actor.${event.actorKind}`);
    const targetName =
      event.targetId === null
        ? null
        : event.targetKind === 'user' || event.targetKind === 'member'
          ? (names.get(event.targetId) ?? t('actor.unknown'))
          : event.targetId;
    const target = targetName ?? '';
    const role = event.metadata.role;
    let sentence: string;
    switch (event.action) {
      case 'member.removed':
        sentence = t('sentence.memberRemoved', { actor: actorName, target });
        break;
      case 'member.role_changed':
        sentence = isRoleName(role)
          ? t('sentence.memberRoleChanged', { actor: actorName, target, role: tRoles(role) })
          : t('sentence.memberRoleChangedNoRole', { actor: actorName, target });
        break;
      case 'flag.changed':
        sentence = t('sentence.flagChanged', { actor: actorName, target });
        break;
      case 'usage.budget_override_set':
        sentence = t('sentence.budgetOverride', { actor: actorName });
        break;
      case 'audit.retention_purged':
        sentence = t('sentence.retentionPurged', { actor: actorName });
        break;
      case 'audit.exported':
        sentence = t('sentence.exported', { actor: actorName });
        break;
      case 'workspace.profile_updated':
        sentence = t('sentence.profileUpdated', { actor: actorName });
        break;
      case 'workspace.slug_renamed': {
        const { from, to } = event.metadata;
        sentence =
          typeof from === 'string' && typeof to === 'string'
            ? t('sentence.slugRenamed', { actor: actorName, from, to })
            : t('sentence.slugRenamedNoSlugs', { actor: actorName });
        break;
      }
      case 'workspace.settings_viewed':
        sentence = t('sentence.settingsViewed', { actor: actorName });
        break;
      default:
        // Actions added later (#228, #27) read as their name until they get a sentence.
        sentence = t('sentence.generic', { actor: actorName, action: event.action });
    }
    const when = format.dateTime(new Date(event.createdAt), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    });
    return { event, sentence, actorName, targetName, when, icon: iconFor(event.action) };
  });
}

export function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  const t = useTranslations('audit.outcome');
  const { tone, icon: Icon } = OUTCOME[outcome];
  return (
    <Badge tone={tone} data-outcome={outcome}>
      <Icon aria-hidden="true" />
      {t(outcome)}
    </Badge>
  );
}

export function AuditSkeleton() {
  const t = useTranslations('audit');
  return (
    <SkeletonGroup
      data-slot="audit-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-3"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="border-line flex items-center gap-3 border-b py-3">
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** `Could not load activity.` with `Try again`, which re-runs the page's server render. */
export function AuditError() {
  const t = useTranslations('audit.error');
  const router = useRouter();
  return (
    <Alert
      tone="danger"
      data-pattern-state="error"
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            router.refresh();
          }}
        >
          {t('retry')}
        </Button>
      }
    >
      {t('title')}
    </Alert>
  );
}

/** Members whose role may not read the audit log (or advocates when the workspace turned it off). */
export function AuditDenied() {
  const t = useTranslations('audit');
  return (
    <Alert tone="info" data-pattern-state="denied">
      {t('denied')}
    </Alert>
  );
}

export interface AuditFeedProps {
  workspace: { id: string; slug: string };
  initialPage: AuditFeedPage;
  members: readonly AuditMember[];
  /** Owners see the IP column. */
  isOwner: boolean;
  filters: AuditFilterValues;
  /** `?event=`: the event whose drawer opens first. */
  initialEventId?: string | undefined;
  actions: AuditFeedActions;
}

export function AuditFeed({
  workspace,
  initialPage,
  members,
  isOwner,
  filters,
  initialEventId,
  actions,
}: AuditFeedProps) {
  const t = useTranslations('audit');
  const tDrawer = useTranslations('audit.drawer');
  const locale = useLocale();
  const online = useOnline();
  const narrow = useMediaQuery(DATA_TABLE_MOBILE_QUERY);
  const reducedMotion = useReducedMotion();
  const [events, setEvents] = useState(initialPage.events);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [openId, setOpenId] = useState<string | null>(
    initialPage.events.some((e) => e.id === initialEventId) ? (initialEventId ?? null) : null,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const container = useRef<HTMLDivElement>(null);

  // A new server page (filters changed) replaces what was loaded: adjusted during render, keyed on
  // the page object, instead of in an effect.
  const [seenPage, setSeenPage] = useState(initialPage);
  if (seenPage !== initialPage) {
    setSeenPage(initialPage);
    setEvents(initialPage.events);
    setCursor(initialPage.nextCursor);
    setActive(0);
    setLoadMoreFailed(false);
  }

  const rows = useRows(events, members);
  const openRow = rows.find((row) => row.event.id === openId) ?? null;
  // J/K drive the table's roving focus; cards (phones) have no row focus.
  const keysEnabled = openId === null && !exportOpen && rows.length > 0 && !narrow;

  /** Focus a table row; the table's `onActiveRowChange` then records and announces it. */
  const move = (delta: number) => {
    const next = Math.min(rows.length - 1, Math.max(0, active + delta));
    container.current?.querySelector<HTMLElement>(`[data-row-index="${String(next)}"]`)?.focus();
  };

  useHotkey(
    'j',
    () => {
      move(1);
    },
    { enabled: keysEnabled },
  );
  useHotkey(
    'k',
    () => {
      move(-1);
    },
    { enabled: keysEnabled },
  );

  const open = (row: AuditRow) => {
    setOpenId(row.event.id);
  };

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    const result = await actions.loadMore({
      workspaceId: workspace.id,
      cursor,
      ...filterBounds(filters),
    });
    setLoadingMore(false);
    if (!result.ok) {
      setLoadMoreFailed(true);
      return;
    }
    setEvents((current) => [...current, ...result.data.events]);
    setCursor(result.data.nextCursor);
  };

  const rowMotion = reducedMotion ? undefined : 'animate-fade-in [--dur-base:150ms]';
  const col = createDataTableColumnHelper<AuditRow>();
  const columns = col.columns([
    col.accessor((row) => row.event.createdAt, {
      id: 'when',
      header: t('columns.when'),
      enableSorting: false,
      cell: ({ row }) => (
        <time dateTime={row.original.event.createdAt} className="text-ink-muted tabular-nums">
          {row.original.when}
        </time>
      ),
    }),
    col.accessor('actorName', { header: t('columns.who'), enableSorting: false }),
    col.accessor('sentence', {
      header: t('columns.what'),
      enableSorting: false,
      cell: ({ row }) => <span className="font-medium">{row.original.sentence}</span>,
    }),
    col.accessor((row) => row.targetName ?? '—', {
      id: 'target',
      header: t('columns.target'),
      enableSorting: false,
    }),
    col.accessor((row) => row.event.outcome, {
      id: 'outcome',
      header: t('columns.outcome'),
      enableSorting: false,
      cell: ({ row }) => <OutcomeBadge outcome={row.original.event.outcome} />,
    }),
    ...(isOwner
      ? [
          col.accessor((row) => row.event.ip ?? '—', {
            id: 'ip',
            header: t('columns.ip'),
            enableSorting: false,
            cell: ({ row }) => (
              <span className="text-ink-muted font-mono text-xs">
                {row.original.event.ip ?? '—'}
              </span>
            ),
          }),
        ]
      : []),
  ]);

  return (
    <div ref={container} data-slot="audit-feed" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <AuditFilters filters={filters} members={members} disabled={!online} />
        <div className="ms-auto">
          <ExportButton
            workspaceId={workspace.id}
            filters={filters}
            disabled={!online}
            open={exportOpen}
            onOpenChange={setExportOpen}
          />
        </div>
      </div>
      {online ? null : (
        <p data-pattern-state="offline" className="text-ink-muted text-sm">
          {t('offline')}
        </p>
      )}
      <p className="text-ink-muted sr-only text-xs md:not-sr-only">{t('shortcuts')}</p>
      <DataTable
        label={t('tableLabel')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.event.id}
        getRowClassName={(row) =>
          cn(row.event.outcome === 'denied' && 'bg-warning-soft', rowMotion) || undefined
        }
        onRowActivate={open}
        onActiveRowChange={(row, index) => {
          setActive(index);
          setAnnouncement(t('selected', { event: row.sentence }));
        }}
        empty={
          <EmptyState
            data-pattern-state="empty"
            icon={<History aria-hidden="true" />}
            title={t('empty')}
            className="py-12"
          />
        }
        labels={{ loading: t('loading') }}
        mobileRender={(row) => (
          <ActivityItem
            data-outcome={row.event.outcome}
            actor={{ name: row.actorName }}
            sentence={row.sentence}
            at={row.event.createdAt}
            icon={row.icon}
            locale={`${locale}-IN`}
            className="py-0"
            trailing={
              <>
                <OutcomeBadge outcome={row.event.outcome} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    open(row);
                  }}
                >
                  {tDrawer('title')}
                </Button>
              </>
            }
          />
        )}
      />
      {cursor ? (
        <div className="flex flex-col items-center gap-2">
          {loadMoreFailed ? (
            <p role="alert" className="text-danger text-sm">
              {t('loadMoreFailed')}
            </p>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            loading={loadingMore}
            disabled={!online}
            onClick={() => {
              void loadMore();
            }}
          >
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {openRow ? (
        <EventDrawer
          row={openRow}
          outcome={<OutcomeBadge outcome={openRow.event.outcome} />}
          isOwner={isOwner}
          side={narrow ? 'bottom' : 'end'}
          onClose={() => {
            setOpenId(null);
          }}
          verify={() =>
            actions.verifyEvent({
              workspaceId: workspace.id,
              eventId: openRow.event.id,
              createdAt: openRow.event.createdAt,
            })
          }
        />
      ) : null}
    </div>
  );
}
