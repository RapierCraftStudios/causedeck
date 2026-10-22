'use client';
// The matters list's client half (#388): the header's `New matter`, the rows (table from 768 px,
// cards below; both come from the server already formatted), the empty states and the list
// keyboard. `j`/`k` move the active row (its link takes focus), `Enter` opens it, `n` opens New
// matter for members who may write while online. `/` (focus search) and `g` then `m` are the
// shell's (lib/shortcuts). Plain keys are ignored while typing (useHotkey) and while a dialog is
// open. The dialog loads in its own chunk on first use, at idle, or right away for `?new=1`.
import { Button, buttonVariants } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { useHotkey } from '@causedeck/ui/hooks';
import { PermissionDenied } from '@causedeck/ui/patterns';
import { FolderOpen, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { MatterRowView } from '../../lib/matters/graph-deps.ts';
import { matterListHref, type MatterListState } from '../../lib/matters/list-params.ts';

import { MatterCard } from './matter-card.tsx';
import { MattersTable } from './matters-table.tsx';
import { useOnline } from './matters-offline-banner.tsx';
import type * as DialogModule from './new-matter-dialog.tsx';
import type { CreateMatterAction } from './new-matter-dialog.tsx';

let loaded: typeof DialogModule | null = null;
let pending: Promise<typeof DialogModule> | null = null;
const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

/** Load the dialog chunk once; a failed load is forgotten, so the next attempt tries again. */
export function loadNewMatterDialog(): Promise<typeof DialogModule> {
  pending ??= import('./new-matter-dialog.tsx').then(
    (mod) => {
      loaded = mod;
      for (const notify of listeners) notify();
      return mod;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

const prefetch = () => {
  loadNewMatterDialog().catch(() => undefined);
};

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => {
      window.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(run, 200);
  return () => {
    window.clearTimeout(id);
  };
}

/** Phones show cards, 768 px and up the table (Tailwind `md`). */
const TABLE_QUERY = '(min-width: 48rem)';

function visibleLayout(): 'table' | 'cards' {
  if (typeof window.matchMedia !== 'function') return 'table';
  return window.matchMedia(TABLE_QUERY).matches ? 'table' : 'cards';
}

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

export interface MattersListProps {
  rows: readonly MatterRowView[];
  state: MatterListState;
  slug: string;
  workspaceId: string;
  /** `matter.write`: New matter is rendered (otherwise absent, not disabled). */
  canWrite: boolean;
  /** No rows: `empty` (nothing yet) or `filtered` (nothing matches). */
  empty?: 'empty' | 'filtered' | undefined;
  /** Open New matter on load (`?new=1`, the palette's `New matter`). */
  openNew?: boolean;
  createAction: CreateMatterAction;
  /** The page title block, rendered beside `New matter`. */
  header: ReactNode;
  /** Filters, between the header and the rows. */
  toolbar?: ReactNode;
  /** Pagination, after the rows. */
  footer?: ReactNode;
}

export function MattersList({
  rows,
  state,
  slug,
  workspaceId,
  canWrite,
  empty,
  openNew = false,
  createAction,
  header,
  toolbar,
  footer,
}: MattersListProps) {
  const t = useTranslations('matters');
  const router = useRouter();
  const online = useOnline();
  const mod = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  );
  const [open, setOpen] = useState(canWrite && openNew);
  const [active, setActive] = useState(-1);
  const invoker = useRef<HTMLElement | null>(null);
  const canCreate = canWrite && online;

  useEffect(() => {
    if (!canWrite) return undefined;
    if (openNew) {
      prefetch();
      return undefined;
    }
    return whenIdle(prefetch);
  }, [canWrite, openNew]);

  // A new page of rows starts without an active row.
  useEffect(() => {
    setActive(-1);
  }, [rows]);

  const openDialog = (from: HTMLElement | null) => {
    if (!canCreate) return;
    invoker.current = from;
    prefetch();
    setOpen(true);
  };

  const focusRow = (index: number) => {
    const row = rows[index];
    if (row === undefined) return;
    const layout = visibleLayout();
    const container = document.querySelector(`[data-matters-layout="${layout}"]`);
    const link =
      container?.querySelector<HTMLElement>(
        layout === 'table'
          ? `[data-matter-row="${row.id}"] [data-matter-link]`
          : `a[data-matter-row="${row.id}"]`,
      ) ?? null;
    if (link === null) return;
    link.focus();
    link.scrollIntoView({ block: 'nearest' });
  };

  const move = (step: 1 | -1) => (event: KeyboardEvent) => {
    if (event.shiftKey || dialogOpen() || rows.length === 0) return;
    event.preventDefault();
    const next = active < 0 ? (step === 1 ? 0 : rows.length - 1) : active + step;
    const clamped = Math.min(Math.max(next, 0), rows.length - 1);
    setActive(clamped);
    focusRow(clamped);
  };

  useHotkey('j', move(1), { preventDefault: false });
  useHotkey('k', move(-1), { preventDefault: false });
  useHotkey(
    'enter',
    (event) => {
      const row = rows[active];
      if (row === undefined || dialogOpen()) return;
      // A focused link or button handles Enter itself.
      const target = event.target as HTMLElement | null;
      if (target?.closest('a, button, [role="button"]')) return;
      event.preventDefault();
      router.push(row.href);
    },
    { preventDefault: false },
  );
  useHotkey(
    'n',
    (event) => {
      // `Shift+N` is the shell's notifications shortcut.
      if (event.shiftKey || !canCreate || dialogOpen()) return;
      event.preventDefault();
      const focused = document.activeElement;
      openDialog(focused instanceof HTMLElement && focused !== document.body ? focused : null);
    },
    { preventDefault: false, enabled: canWrite },
  );

  const newButton = (variant: 'primary' | 'secondary' = 'primary') =>
    canWrite ? (
      <Button
        type="button"
        variant={variant}
        data-slot="new-matter"
        disabled={!online}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={(event) => {
          openDialog(event.currentTarget);
        }}
      >
        <Plus aria-hidden="true" />
        {t('new.trigger')}
      </Button>
    ) : null;

  let body: ReactNode;
  if (empty === 'empty') {
    body = (
      <EmptyState
        data-pattern-state="empty"
        icon={<FolderOpen />}
        title={t('empty.title')}
        description={t('empty.body')}
        action={newButton()}
        secondaryAction={
          <Link
            href={`/w/${encodeURIComponent(slug)}/inbox`}
            className={buttonVariants({ variant: canWrite ? 'ghost' : 'secondary' })}
          >
            {t('empty.openInbox')}
          </Link>
        }
      />
    );
  } else if (empty === 'filtered') {
    body = (
      <EmptyState
        data-pattern-state="empty"
        data-matters-empty="filtered"
        icon={<FolderOpen />}
        title={t('filteredEmpty.title')}
        action={
          <Link
            href={matterListHref(slug, { sort: state.sort })}
            className={buttonVariants({ variant: 'secondary' })}
          >
            {t('filteredEmpty.clear')}
          </Link>
        }
      />
    );
  } else {
    body = (
      <>
        <div data-matters-layout="table" className="max-md:hidden">
          <MattersTable rows={rows} state={state} slug={slug} activeIndex={active} />
        </div>
        <ul
          data-matters-layout="cards"
          aria-label={t('listLabel')}
          className="flex flex-col gap-3 md:hidden"
        >
          {rows.map((row, index) => (
            <MatterCard key={row.id} row={row} index={index} active={index === active} />
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {header}
        {empty === 'empty' ? null : newButton()}
      </div>
      {toolbar}
      {body}
      {footer}
      {mod !== null && canWrite ? (
        <mod.NewMatterDialog
          workspaceId={workspaceId}
          action={createAction}
          open={open}
          offline={!online}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next && openNew)
              router.replace(matterListHref(slug, state, { cursor: state.cursor }));
          }}
          returnFocus={() => invoker.current}
        />
      ) : null}
    </>
  );
}

/** The list's permission-denied state, in the matters copy. */
export function MattersPermissionDenied() {
  const t = useTranslations('matters');
  return (
    <div data-route="matters" className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <PermissionDenied message={t('denied')} />
    </div>
  );
}
