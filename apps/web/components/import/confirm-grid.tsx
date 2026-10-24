'use client';
// The bootstrap import confirm grid (#57 part 5, #551): one row per proposed matter, sorted by next
// date. The lawyer includes or leaves out, renames, merges, splits and moves proceedings without
// leaving the grid; a row whose sources disagree on a date is blocked until a date is picked, and
// there is no confirm-all that steps over it. Keyboard: arrows, Space, Enter, m, s, e, ?,
// Cmd/Ctrl+Enter. The grouping is saved, then the plan applied, by `onConfirm` (confirmImport).
import type { ImportPlan } from '@causedeck/core/import';
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { ShortcutsDialog, type Shortcut } from '@causedeck/ui/shortcuts-dialog';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';

import {
  groupsOf,
  keysetOf,
  mergeGroups,
  moveProceeding,
  previewMatters,
  renameGroup,
  splitProceeding,
  type ConfirmInput,
  type EditGroup,
} from '../../lib/import/plan-edit.ts';
import type { Result } from '../../lib/safe-action.ts';
import type { ApplyView } from '../../app/(app)/w/[slug]/import/actions.ts';

import { IssuesPanel, type PanelIssue } from './issues-panel.tsx';
import { MatterGroupRow } from './matter-group-row.tsx';
import { proceedingName } from './proceeding-chip.tsx';
import { ResultSummary } from './result-summary.tsx';

export interface ConfirmGridProps {
  plan: ImportPlan;
  /** Issues of the batch's files: missing identifiers, unreadable files, A0-only documents. */
  fileIssues?: readonly PanelIssue[];
  courtDayHref: string;
  onConfirm: (input: ConfirmInput) => Promise<Result<ApplyView>>;
  onUndo: () => Promise<Result<unknown>>;
  onAddIdentifiers: () => void;
  onRetryFile: (fileId: string) => void;
  onKeepFile: (fileId: string) => void;
}

type Phase = 'editing' | 'confirming' | 'failed' | 'done';

export function ConfirmGrid({
  plan,
  fileIssues = [],
  courtDayHref,
  onConfirm,
  onUndo,
  onAddIdentifiers,
  onRetryFile,
  onKeepFile,
}: ConfirmGridProps) {
  const t = useTranslations('importReview');
  const [groups, setGroups] = useState<EditGroup[]>(() => groupsOf(plan));
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('editing');
  const [applied, setApplied] = useState<ApplyView | null>(null);
  const [undo, setUndo] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [help, setHelp] = useState(false);
  const [announce, setAnnounce] = useState('');
  const titles = useRef(new Map<string, HTMLInputElement>());

  const rows = previewMatters(plan, groups, resolved);
  const included = rows.filter((m) => !excluded.has(m.tempId));
  const blocked = included.some((m) => m.open.length > 0);
  const busy = phase === 'confirming';
  const dirty = JSON.stringify(groups) !== JSON.stringify(groupsOf(plan));
  const active = rows.find((m) => m.tempId === activeId) ?? null;
  const activeIndex = active === null ? -1 : rows.indexOf(active);

  const nameOf = (key: string) => {
    for (const m of rows)
      for (const p of m.proceedings) if (p.key === key) return proceedingName(p);
    return key;
  };
  const titleOf = (id: string) => groups.find((g) => g.tempId === id)?.title ?? id;

  const panelIssues: PanelIssue[] = [
    ...rows.flatMap((m): PanelIssue[] => [
      ...(m.issues.some((i) => i.code === 'low_confidence')
        ? [{ kind: 'low_confidence' as const, matterId: m.tempId, title: m.title }]
        : []),
      ...(m.open.length > 0
        ? [{ kind: 'conflicting_dates' as const, matterId: m.tempId, title: m.title }]
        : []),
    ]),
    ...fileIssues,
  ];

  const focusMatter = (id: string) => {
    setActiveId(id);
    // Real focus follows the active row, so arrows keep working and a screen reader follows along.
    const row = document.querySelector<HTMLElement>(`[data-matter-id="${CSS.escape(id)}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'center' });
  };
  const merge = (fromId: string) => {
    const at = rows.findIndex((m) => m.tempId === fromId);
    const into = rows[at + 1];
    if (into === undefined) return;
    setGroups((g) => mergeGroups(g, into.tempId, fromId));
    setActiveId(into.tempId);
    setAnnounce(t('grid.merged', { from: titleOf(fromId), into: into.title }));
  };
  const split = (id: string) => {
    const row = rows.find((m) => m.tempId === id);
    const last = row?.proceedings.at(-1);
    if (row === undefined || last === undefined || row.proceedings.length < 2) return;
    setGroups((g) => splitProceeding(g, last.key, proceedingName(last)));
    setAnnounce(t('grid.split', { label: proceedingName(last) }));
  };
  const move = (key: string, toId: string) => {
    setGroups((g) => moveProceeding(g, key, toId));
    setAnnounce(t('grid.moved', { label: nameOf(key), title: titleOf(toId) }));
  };
  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  const confirm = async () => {
    if (blocked || busy || included.length === 0) {
      if (blocked) setAnnounce(t('blockedNote'));
      return;
    }
    setPhase('confirming');
    const keysets = groups
      .filter((g) => excluded.has(g.tempId))
      .map((g) => keysetOf(g.proceedingKeys));
    const result = await onConfirm({ groups, dirty, excluded: keysets, resolvedDates: resolved });
    if (result.ok) {
      setApplied(result.data);
      setPhase('done');
    } else {
      setPhase('failed');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void confirm();
      return;
    }
    const target = event.target as HTMLElement;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    const onButton = target.tagName === 'BUTTON';
    const id = active?.tempId;
    const go = (to: number) => {
      const next = rows[Math.min(Math.max(to, 0), rows.length - 1)];
      if (next !== undefined) focusMatter(next.tempId);
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        go(activeIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        go(activeIndex < 0 ? 0 : activeIndex - 1);
        break;
      case ' ':
        if (onButton || id === undefined) return;
        event.preventDefault();
        setExcluded((s) => toggle(s, id));
        break;
      case 'Enter':
        if (onButton || id === undefined) return;
        event.preventDefault();
        setExpanded((s) => toggle(s, id));
        break;
      case 'm':
        if (id !== undefined) merge(id);
        break;
      case 's':
        if (id !== undefined) split(id);
        break;
      case 'e':
        if (id !== undefined) {
          event.preventDefault();
          titles.current.get(id)?.focus();
        }
        break;
      case '?':
        // The grid has its own list; stop the app shell's `?` so two dialogs do not stack.
        event.preventDefault();
        event.nativeEvent.stopImmediatePropagation();
        setHelp(true);
        break;
    }
  };

  const shortcuts: Shortcut[] = [
    { keys: 'up', description: t('shortcuts.move') },
    { keys: 'space', description: t('shortcuts.toggle') },
    { keys: 'return', description: t('shortcuts.expand') },
    { keys: 'm', description: t('shortcuts.merge') },
    { keys: 's', description: t('shortcuts.split') },
    { keys: 'e', description: t('shortcuts.edit') },
    { keys: 'mod+return', description: t('shortcuts.confirm') },
    { keys: '?', description: t('shortcuts.help') },
  ];

  if (phase === 'done' && applied !== null) {
    return (
      <ResultSummary
        created={applied.created}
        duplicates={applied.duplicates}
        unresolvedProceedingKeys={applied.unresolvedProceedingKeys}
        courtDayHref={courtDayHref}
        undoing={undo === 'running'}
        undone={undo === 'done'}
        undoFailed={undo === 'failed'}
        onUndo={() => {
          setUndo('running');
          void onUndo().then((r) => {
            setUndo(r.ok ? 'done' : 'failed');
          });
        }}
      />
    );
  }

  return (
    <div data-slot="confirm-grid" onKeyDown={onKeyDown} className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-ink text-xl font-semibold">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('intro')}</p>
        <p className="text-ink-muted text-sm">
          {t('summary', { included: included.length, total: rows.length })}
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {rows.length === 0 ? (
            <p className="text-ink-muted">{t('empty')}</p>
          ) : (
            <ul aria-label={t('grid.label')} className="flex flex-col gap-3">
              {rows.map((m, index) => (
                <MatterGroupRow
                  key={m.tempId}
                  matter={m}
                  index={index}
                  total={rows.length}
                  active={m.tempId === activeId}
                  tabStop={active === null ? index === 0 : m.tempId === activeId}
                  included={!excluded.has(m.tempId)}
                  expanded={expanded.has(m.tempId)}
                  resolved={resolved}
                  targets={rows
                    .filter((o) => o.tempId !== m.tempId)
                    .map((o) => ({ tempId: o.tempId, title: o.title }))}
                  canMerge={index < rows.length - 1}
                  disabled={busy}
                  registerTitle={(el) => {
                    if (el === null) titles.current.delete(m.tempId);
                    else titles.current.set(m.tempId, el);
                  }}
                  onActivate={() => {
                    setActiveId(m.tempId);
                  }}
                  onToggleInclude={() => {
                    setExcluded((s) => toggle(s, m.tempId));
                  }}
                  onToggleExpand={() => {
                    setExpanded((s) => toggle(s, m.tempId));
                  }}
                  onRename={(title) => {
                    setGroups((g) => renameGroup(g, m.tempId, title));
                    setAnnounce(t('grid.renamed', { title }));
                  }}
                  onPickDate={(key, date) => {
                    setResolved((r) => ({ ...r, [key]: date }));
                  }}
                  onMove={move}
                  onMerge={() => {
                    merge(m.tempId);
                  }}
                  onSplit={() => {
                    split(m.tempId);
                  }}
                  onFocusTitle={() => titles.current.get(m.tempId)?.focus()}
                />
              ))}
            </ul>
          )}
          {blocked ? <Alert tone="warning">{t('blockedNote')}</Alert> : null}
          {phase === 'failed' ? (
            <Alert tone="danger" role="alert">
              {dirty ? t('saveFailed') : t('failed')}
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={blocked || busy || included.length === 0}
              onClick={() => void confirm()}
            >
              {busy ? t('confirming') : t('confirm', { count: included.length })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setHelp(true);
              }}
            >
              {t('shortcuts.open')}
            </Button>
          </div>
        </div>
        <aside className="flex flex-col gap-4" aria-label={t('preview.title')}>
          <IssuesPanel
            issues={panelIssues}
            disabled={busy}
            onFocusMatter={focusMatter}
            onAddIdentifiers={onAddIdentifiers}
            onRetryFile={onRetryFile}
            onKeepFile={onKeepFile}
          />
          <section data-slot="source-preview" aria-labelledby="import-preview-title">
            <h2 id="import-preview-title" className="text-ink text-base font-semibold">
              {t('preview.title')}
            </h2>
            {active === null ? (
              <p className="text-ink-muted text-sm">{t('preview.empty')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {active.proceedings.map((p) => (
                  <li key={p.key} className="border-line rounded-md border p-2">
                    <p className="text-ink font-medium">{proceedingName(p)}</p>
                    <p className="text-ink-muted">
                      {t('preview.sources', { count: p.sources.length })}
                    </p>
                    <p className="text-ink-muted">
                      {[...new Set(p.sources.map((s) => s.kind))]
                        .map((kind) => t('preview.kind', { kind }))
                        .join(', ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ShortcutsDialog
        shortcuts={shortcuts}
        open={help}
        onOpenChange={setHelp}
        enableHotkey={false}
        labels={{ title: t('shortcuts.title'), close: t('shortcuts.close') }}
      />
    </div>
  );
}
