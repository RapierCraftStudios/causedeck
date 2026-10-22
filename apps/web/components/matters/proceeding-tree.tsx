'use client';
// The Proceedings tab's tree (#392, #40 part 4): the matter's proceedings as a `role="tree"`, main
// petitions with their W.M.P./I.A./misc children indented (`role="group"`), appeals after the
// proceeding they appeal from. Keyboard (WAI-ARIA tree, roving tabindex): Up/Down move, Right
// expands or enters the first child, Left collapses or goes to the parent, Home/End; only the
// active row and its controls are in the tab order. Members who may write get the toolbar (`Add
// proceeding`, `Merge another matter in`, `Split into a new matter`), `Edit` and the state menu on
// each row; viewers and clerks get none of them. Offline, every mutation is off. Results are
// announced in the matter's polite live region. The dialogs return focus to their invoker.
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { GitMerge, Plus, Scale, Split } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';

import {
  flattenRows,
  type ForumOption,
  type ProceedingRowView,
} from '../../lib/matters/proceedings-view.ts';

import { useOnline } from './matters-offline-banner.tsx';
import {
  MergeMatterDialog,
  SplitMatterDialog,
  type MergeActions,
  type SplitActions,
} from './merge-split-dialogs.tsx';
import { ProceedingForm, type ProceedingFormActions } from './proceeding-form.tsx';
import { ProceedingRow } from './proceeding-row.tsx';
import type { TransitionProceedingAction } from './state-transition-menu.tsx';

export interface ProceedingTreeActions {
  form: ProceedingFormActions;
  transition: TransitionProceedingAction;
  merge: MergeActions;
  split: SplitActions;
}

export interface ProceedingTreeProps {
  workspaceId: string;
  slug: string;
  matterId: string;
  rows: ProceedingRowView[];
  forums: readonly ForumOption[];
  /** `matter.write`: the toolbar, Edit and the state menus. */
  canWrite: boolean;
  /** Present only for writers (absent, not disabled, for everyone else). */
  actions?: ProceedingTreeActions | undefined;
  forcedOffline?: boolean;
}

type Overlay =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; row: ProceedingRowView }
  | { kind: 'merge'; initialMatterId?: string }
  | { kind: 'split' };

interface VisibleRow {
  row: ProceedingRowView;
  parentId: string | null;
}

/** The rows a keyboard user can reach: collapsed rows hide their children. */
export function visibleRows(
  rows: ProceedingRowView[],
  collapsed: ReadonlySet<string>,
): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (list: ProceedingRowView[], parentId: string | null) => {
    for (const row of list) {
      out.push({ row, parentId });
      if (!collapsed.has(row.id)) walk(row.children, row.id);
    }
  };
  walk(rows, null);
  return out;
}

export function ProceedingTree({
  workspaceId,
  slug,
  matterId,
  rows,
  forums,
  canWrite,
  actions,
  forcedOffline = false,
}: ProceedingTreeProps) {
  const t = useTranslations('matters.workspace.proceedingsTab');
  const online = useOnline();
  const offline = forcedOffline || !online;
  const writer = canWrite && actions !== undefined;
  const [activeId, setActiveId] = useState<string | null>(rows[0]?.id ?? null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const items = useRef(new Map<string, HTMLLIElement>());
  const invoker = useRef<HTMLElement | null>(null);
  const all = flattenRows(rows);
  const current = all.some((row) => row.id === activeId) ? activeId : (rows[0]?.id ?? null);

  function open(next: Overlay, from: HTMLElement | null) {
    invoker.current = from;
    setOverlay(next);
  }
  const close = () => {
    setOverlay({ kind: 'none' });
  };
  const returnFocus = () => invoker.current;

  function focusRow(id: string) {
    setActiveId(id);
    items.current.get(id)?.focus();
  }

  function toggle(id: string, expand: boolean) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (expand) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>, row: ProceedingRowView) {
    // Keys on the row's own controls (buttons, menus, checkboxes) are theirs.
    if (event.target !== event.currentTarget) return;
    const list = visibleRows(rows, collapsed);
    const index = list.findIndex((entry) => entry.row.id === row.id);
    const entry = list[index];
    if (entry === undefined) return;
    const hasChildren = row.children.length > 0;
    const isOpen = hasChildren && !collapsed.has(row.id);
    let handled = true;
    switch (event.key) {
      case 'ArrowDown': {
        const next = list[index + 1];
        if (next) focusRow(next.row.id);
        break;
      }
      case 'ArrowUp': {
        const prev = list[index - 1];
        if (prev) focusRow(prev.row.id);
        break;
      }
      case 'ArrowRight': {
        if (hasChildren && !isOpen) toggle(row.id, true);
        else if (isOpen && row.children[0]) focusRow(row.children[0].id);
        break;
      }
      case 'ArrowLeft': {
        if (isOpen) toggle(row.id, false);
        else if (entry.parentId !== null) focusRow(entry.parentId);
        break;
      }
      case 'Home': {
        const first = list[0];
        if (first) focusRow(first.row.id);
        break;
      }
      case 'End': {
        const last = list.at(-1);
        if (last) focusRow(last.row.id);
        break;
      }
      case 'Escape': {
        // Split mode: Esc leaves it (dialogs handle their own Esc and never reach a row).
        if (!selecting) {
          handled = false;
          break;
        }
        cancelSplit();
        break;
      }
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function cancelSplit() {
    setSelecting(false);
    setSelected(new Set());
  }

  function renderItems(list: ProceedingRowView[]) {
    return list.map((row) => {
      const hasChildren = row.children.length > 0;
      const isOpen = hasChildren && !collapsed.has(row.id);
      const active = row.id === current;
      return (
        <li
          key={row.id}
          ref={(element) => {
            if (element === null) items.current.delete(row.id);
            else items.current.set(row.id, element);
          }}
          role="treeitem"
          aria-level={row.depth}
          aria-expanded={hasChildren ? isOpen : undefined}
          aria-selected={selecting ? selected.has(row.id) : undefined}
          aria-label={row.label}
          tabIndex={active ? 0 : -1}
          data-treeitem={row.id}
          // The ring goes round the row itself, not the whole subtree of its children.
          className="border-line [&:focus-visible>[data-proceeding-row]]:outline-ring border-b py-3 last:border-b-0 focus-visible:outline-none [&:focus-visible>[data-proceeding-row]]:outline-2 [&:focus-visible>[data-proceeding-row]]:outline-offset-2"
          onFocus={(event) => {
            if (event.target === event.currentTarget) setActiveId(row.id);
          }}
          onKeyDown={(event) => {
            onKeyDown(event, row);
          }}
        >
          <ProceedingRow
            row={row}
            workspaceId={workspaceId}
            slug={slug}
            active={active}
            offline={offline}
            canWrite={writer}
            transition={actions?.transition ?? (() => Promise.reject(new Error('read only')))}
            {...(writer
              ? {
                  onEdit: (edit: ProceedingRowView) => {
                    open({ kind: 'edit', row: edit }, items.current.get(edit.id) ?? null);
                  },
                }
              : {})}
            selecting={selecting}
            selected={selected.has(row.id)}
            {...(hasChildren
              ? {
                  expanded: isOpen,
                  onToggle: () => {
                    toggle(row.id, !isOpen);
                  },
                }
              : {})}
            onSelectedChange={(value) => {
              setSelected((prev) => {
                const next = new Set(prev);
                if (value) next.add(row.id);
                else next.delete(row.id);
                return next;
              });
            }}
          />
          {isOpen ? (
            <ul role="group" className="border-line ms-4 mt-2 border-s ps-3">
              {renderItems(row.children)}
            </ul>
          ) : null}
        </li>
      );
    });
  }

  const toolbar = writer ? (
    <div
      role="toolbar"
      aria-label={t('toolbarLabel')}
      className={`flex flex-wrap gap-2 ${selecting ? 'bg-surface sticky top-0 py-2' : ''}`}
    >
      {selecting ? (
        <>
          <p className="text-ink-muted w-full text-sm">{t('splitHint')}</p>
          <Button
            type="button"
            data-split-continue=""
            disabled={selected.size === 0 || offline}
            onClick={(event) => {
              open({ kind: 'split' }, event.currentTarget);
            }}
          >
            {t('splitContinue', { count: selected.size })}
          </Button>
          <Button type="button" variant="secondary" onClick={cancelSplit}>
            {t('splitCancel')}
          </Button>
        </>
      ) : (
        <>
          {/* On an empty tree the empty state carries the one primary `Add proceeding`. */}
          {rows.length > 0 ? (
            <Button
              type="button"
              data-add-proceeding=""
              disabled={offline}
              onClick={(event) => {
                open({ kind: 'add' }, event.currentTarget);
              }}
            >
              <Plus aria-hidden="true" />
              {t('add')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            data-merge-open=""
            disabled={offline}
            onClick={(event) => {
              open({ kind: 'merge' }, event.currentTarget);
            }}
          >
            <GitMerge aria-hidden="true" />
            {t('mergeIn')}
          </Button>
          {all.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              data-split-start=""
              disabled={offline}
              onClick={() => {
                setSelecting(true);
              }}
            >
              <Split aria-hidden="true" />
              {t('splitStart')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  ) : null;

  return (
    <section
      aria-labelledby="matter-proceedings-title"
      data-slot="proceedings-tab"
      className="flex flex-col gap-4"
    >
      <h2 id="matter-proceedings-title" className="text-ink-muted text-sm font-medium">
        {t('title')}
      </h2>
      {toolbar}
      {rows.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          data-proceedings="empty"
          icon={<Scale />}
          title={t('empty.title')}
          description={t('empty.body')}
          {...(writer
            ? {
                action: (
                  <Button
                    type="button"
                    data-empty-add=""
                    disabled={offline}
                    onClick={(event) => {
                      open({ kind: 'add' }, event.currentTarget);
                    }}
                  >
                    {t('add')}
                  </Button>
                ),
              }
            : {})}
        />
      ) : (
        <ul role="tree" aria-label={t('treeLabel')} aria-multiselectable={selecting || undefined}>
          {renderItems(rows)}
        </ul>
      )}
      {actions !== undefined && (overlay.kind === 'add' || overlay.kind === 'edit') ? (
        <ProceedingForm
          workspaceId={workspaceId}
          matterId={matterId}
          forums={forums}
          rows={all}
          editing={overlay.kind === 'edit' ? overlay.row : undefined}
          actions={actions.form}
          offline={offline}
          onClose={close}
          returnFocus={returnFocus}
          onOpenExisting={(id) => {
            invoker.current = items.current.get(id) ?? null;
            focusRow(id);
          }}
          onMergeMatter={(id) => {
            setOverlay({ kind: 'merge', initialMatterId: id });
          }}
        />
      ) : null}
      {actions !== undefined && overlay.kind === 'merge' ? (
        <MergeMatterDialog
          workspaceId={workspaceId}
          matterId={matterId}
          initialMatterId={overlay.initialMatterId}
          actions={actions.merge}
          offline={offline}
          onClose={close}
          returnFocus={returnFocus}
        />
      ) : null}
      {actions !== undefined && overlay.kind === 'split' ? (
        <SplitMatterDialog
          workspaceId={workspaceId}
          slug={slug}
          matterId={matterId}
          proceedingIds={[...selected]}
          actions={actions.split}
          offline={offline}
          onClose={close}
          onDone={() => {
            setSelecting(false);
            setSelected(new Set());
          }}
          returnFocus={returnFocus}
        />
      ) : null}
    </section>
  );
}
