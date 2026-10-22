'use client';
// The merge and split dialogs of the Proceedings tab (#392, #40 part 4; C02 #365).
// - Merge: pick another matter (the matters search) to merge into this one. The preview
//   (`previewMergeAction`) lists the proceedings and counts the documents and obligations that would
//   move. A sensitive matter cannot be merged with a non-sensitive one (CA-10): the dialog explains
//   why and offers no Merge button; differently restricted, merged or archived matters say so too.
// - Split: the proceedings selected in the tree move to a new matter with the title typed here; the
//   preview counts their obligations and the links that stay across the two matters.
// Confirming calls `mergeMattersAction` / `splitMatterAction` (the services decide again); success
// closes the dialog, announces, refreshes and shows a toast with Undo for 10 seconds that calls the
// inverse with the returned `UndoPayload`. `Esc` closes and focus returns to the invoker.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { Skeleton } from '@causedeck/ui/skeleton';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';
import { showUndoToast } from './undo-toast.tsx';

export interface MovePreviewView {
  proceedings: { id: string; caseType: string; number: string | null; year: number | null }[];
  documents: number;
  obligations: number;
  crossingLinks: number;
  intoSensitive: boolean;
  fromSensitive: boolean;
  blocked: 'sensitive' | 'restricted' | 'merged' | 'archived' | null;
}

export interface MatterHit {
  id: string;
  title: string;
  forum: string | null;
  sensitive: boolean;
}

export interface MergeActions {
  search: (input: { workspaceId: string; q: string }) => Promise<Result<MatterHit[]>>;
  preview: (input: {
    workspaceId: string;
    intoMatterId: string;
    fromMatterId: string;
  }) => Promise<Result<MovePreviewView>>;
  merge: (input: {
    workspaceId: string;
    intoMatterId: string;
    fromMatterId: string;
  }) => Promise<Result<{ undo: unknown }>>;
  undo: (input: { workspaceId: string; payload: never }) => Promise<Result<unknown>>;
}

export interface SplitActions {
  preview: (input: {
    workspaceId: string;
    matterId: string;
    proceedingIds: string[];
  }) => Promise<Result<MovePreviewView>>;
  split: (input: {
    workspaceId: string;
    slug: string;
    matterId: string;
    proceedingIds: string[];
    newTitle: string;
  }) => Promise<Result<{ undo: unknown; newMatterHref: string }>>;
  undo: (input: { workspaceId: string; payload: never }) => Promise<Result<unknown>>;
}

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; preview: MovePreviewView }
  | { kind: 'failed' };

function caseLabel(p: MovePreviewView['proceedings'][number]): string {
  return p.number !== null && p.year !== null
    ? `${p.caseType} ${p.number}/${String(p.year)}`
    : p.caseType;
}

function useUndoLabels() {
  const t = useTranslations('matters.workspace.proceedingsTab.undo');
  return { action: t('action'), done: t('done'), conflict: t('conflict'), failed: t('failed') };
}

function failed<T>(): Result<T> {
  return { ok: false, error: { code: 'INTERNAL', message: '' } };
}

async function run<T>(call: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await call();
  } catch {
    return failed<T>();
  }
}

/** What moves, or why it cannot. */
function PreviewBody({ state, split }: { state: PreviewState; split: boolean }) {
  const t = useTranslations('matters.workspace.proceedingsTab');
  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') {
    return (
      <div role="status" aria-label={t('merge.checking')} className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <Alert tone="danger" role="alert">
        {split ? t('split.failed') : t('merge.failed')}
      </Alert>
    );
  }
  const { preview } = state;
  return (
    <div data-move-preview="" className="flex flex-col gap-2">
      {preview.blocked === null ? null : (
        <Alert tone="warning" role="alert" data-move-blocked={preview.blocked}>
          {t(`merge.blocked.${preview.blocked}`)}
        </Alert>
      )}
      <h3 className="text-sm font-medium">{split ? t('split.moves') : t('merge.moves')}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        <li data-moves="proceedings">
          {t('merge.proceedingsCount', { count: preview.proceedings.length })}
          {preview.proceedings.length > 0 ? (
            <span className="text-ink-muted">
              {': '}
              {preview.proceedings.map(caseLabel).join(', ')}
            </span>
          ) : null}
        </li>
        {split ? null : (
          <li data-moves="documents">{t('merge.documentsCount', { count: preview.documents })}</li>
        )}
        <li data-moves="obligations">
          {t('merge.obligationsCount', { count: preview.obligations })}
        </li>
        {split ? (
          <li data-moves="crossing">{t('split.crossing', { count: preview.crossingLinks })}</li>
        ) : null}
      </ul>
    </div>
  );
}

interface ShellProps {
  slot: string;
  title: string;
  description: string;
  onClose: () => void;
  returnFocus?: (() => HTMLElement | null) | undefined;
  children: ReactNode;
}

function DialogShell({ slot, title, description, onClose, returnFocus, children }: ShellProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-slot={slot}
        onCloseAutoFocus={(event) => {
          const element = returnFocus?.() ?? null;
          if (element === null) return;
          event.preventDefault();
          element.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export interface MergeMatterDialogProps {
  workspaceId: string;
  /** The matter the tab is on: the one merged into. */
  matterId: string;
  /** Preselected (the duplicate prompt's `Merge`). */
  initialMatterId?: string | undefined;
  actions: MergeActions;
  offline?: boolean;
  onClose: () => void;
  returnFocus?: (() => HTMLElement | null) | undefined;
}

export function MergeMatterDialog({
  workspaceId,
  matterId,
  initialMatterId,
  actions,
  offline = false,
  onClose,
  returnFocus,
}: MergeMatterDialogProps) {
  const t = useTranslations('matters.workspace.proceedingsTab');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const undoLabels = useUndoLabels();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MatterHit[]>([]);
  const [fromId, setFromId] = useState<string | null>(initialMatterId ?? null);
  const [preview, setPreview] = useState<PreviewState>(
    initialMatterId === undefined ? { kind: 'idle' } : { kind: 'loading' },
  );
  const [pending, setPending] = useState(false);
  const [mergeFailed, setMergeFailed] = useState(false);
  const searchSeq = useRef(0);
  const previewSeq = useRef(0);

  async function fetchPreview(from: string) {
    const seq = ++previewSeq.current;
    const result = await run(() =>
      actions.preview({ workspaceId, intoMatterId: matterId, fromMatterId: from }),
    );
    if (seq !== previewSeq.current) return;
    setPreview(result.ok ? { kind: 'ready', preview: result.data } : { kind: 'failed' });
  }

  // The preselected matter (the duplicate prompt's `Merge`) is previewed once, on open.
  const previewInitial = useEffectEvent(() => {
    if (initialMatterId !== undefined) void fetchPreview(initialMatterId);
  });
  useEffect(() => {
    previewInitial();
  }, []);

  async function onSearch(text: string) {
    setQuery(text);
    const seq = ++searchSeq.current;
    if (text.trim().length < 2) {
      setHits([]);
      return;
    }
    const result = await run(() => actions.search({ workspaceId, q: text.trim() }));
    if (seq !== searchSeq.current) return;
    setHits(result.ok ? result.data.filter((hit) => hit.id !== matterId) : []);
  }

  function choose(id: string) {
    setFromId(id);
    setMergeFailed(false);
    setPreview({ kind: 'loading' });
    void fetchPreview(id);
  }

  async function onMerge() {
    if (fromId === null || pending || offline) return;
    setPending(true);
    setMergeFailed(false);
    const result = await run(() =>
      actions.merge({ workspaceId, intoMatterId: matterId, fromMatterId: fromId }),
    );
    setPending(false);
    if (!result.ok) {
      setMergeFailed(true);
      return;
    }
    const payload = result.data.undo as never;
    onClose();
    announce(t('merge.done'));
    showUndoToast({
      message: t('merge.done'),
      undo: () => actions.undo({ workspaceId, payload }),
      labels: undoLabels,
      announce,
      onUndone: () => {
        router.refresh();
      },
    });
    router.refresh();
  }

  const ready = preview.kind === 'ready' ? preview.preview : null;
  const canMerge = fromId !== null && ready !== null && ready.blocked === null;

  return (
    <DialogShell
      slot="merge-dialog"
      title={t('merge.title')}
      description={t('merge.description')}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <div className="flex flex-col gap-4">
        <Field label={t('merge.pick')} hint={t('merge.searchHint')}>
          <Input
            type="search"
            data-merge-search=""
            value={query}
            autoComplete="off"
            onChange={(event) => void onSearch(event.target.value)}
          />
        </Field>
        {query.trim().length >= 2 && hits.length === 0 ? (
          <p className="text-ink-muted text-sm">{t('merge.noResults')}</p>
        ) : null}
        {hits.length > 0 ? (
          <ul aria-label={t('merge.pick')} className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {hits.map((hit) => (
              <li key={hit.id}>
                <Button
                  type="button"
                  variant={hit.id === fromId ? 'secondary' : 'ghost'}
                  aria-pressed={hit.id === fromId}
                  data-merge-hit={hit.id}
                  className="w-full justify-start"
                  onClick={() => {
                    choose(hit.id);
                  }}
                >
                  <span className="truncate">{hit.title}</span>
                  {hit.forum === null ? null : (
                    <span className="text-ink-muted truncate text-xs">{hit.forum}</span>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <PreviewBody state={preview} split={false} />
        {mergeFailed ? (
          <Alert tone="danger" role="alert">
            {t('merge.failed')}
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('merge.cancel')}
          </Button>
          {ready?.blocked == null ? (
            <Button
              type="button"
              data-merge-confirm=""
              loading={pending}
              disabled={!canMerge || pending || offline}
              onClick={() => void onMerge()}
            >
              {t('merge.confirm')}
            </Button>
          ) : null}
        </DialogFooter>
      </div>
    </DialogShell>
  );
}

export interface SplitMatterDialogProps {
  workspaceId: string;
  slug: string;
  matterId: string;
  proceedingIds: string[];
  actions: SplitActions;
  offline?: boolean;
  onClose: () => void;
  /** After a split: leave split mode. */
  onDone?: () => void;
  returnFocus?: (() => HTMLElement | null) | undefined;
}

export function SplitMatterDialog({
  workspaceId,
  slug,
  matterId,
  proceedingIds,
  actions,
  offline = false,
  onClose,
  onDone,
  returnFocus,
}: SplitMatterDialogProps) {
  const t = useTranslations('matters.workspace.proceedingsTab');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const undoLabels = useUndoLabels();
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<PreviewState>({ kind: 'loading' });
  const [pending, setPending] = useState(false);
  const [splitFailed, setSplitFailed] = useState(false);

  // The selection is fixed while the dialog is open: one preview, on open.
  const fetchPreview = useEffectEvent(async (isLive: () => boolean) => {
    const result = await run(() => actions.preview({ workspaceId, matterId, proceedingIds }));
    if (isLive())
      setPreview(result.ok ? { kind: 'ready', preview: result.data } : { kind: 'failed' });
  });
  useEffect(() => {
    let live = true;
    void fetchPreview(() => live);
    return () => {
      live = false;
    };
  }, []);

  async function onSplit() {
    if (pending || offline) return;
    if (title.trim() === '') {
      setTitleError(t('split.titleRequired'));
      return;
    }
    setPending(true);
    setSplitFailed(false);
    const result = await run(() =>
      actions.split({ workspaceId, slug, matterId, proceedingIds, newTitle: title.trim() }),
    );
    setPending(false);
    if (!result.ok) {
      setSplitFailed(true);
      return;
    }
    const payload = result.data.undo as never;
    onClose();
    onDone?.();
    announce(t('split.done'));
    showUndoToast({
      message: t('split.done'),
      undo: () => actions.undo({ workspaceId, payload }),
      labels: undoLabels,
      announce,
      onUndone: () => {
        router.refresh();
      },
    });
    router.refresh();
  }

  const ready = preview.kind === 'ready' ? preview.preview : null;

  return (
    <DialogShell
      slot="split-dialog"
      title={t('split.title')}
      description={t('split.description')}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <div className="flex flex-col gap-4">
        <Field label={t('split.newTitle')} required error={titleError}>
          <Input
            data-split-title=""
            value={title}
            autoComplete="off"
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleError(undefined);
            }}
          />
        </Field>
        <PreviewBody state={preview} split />
        {splitFailed ? (
          <Alert tone="danger" role="alert">
            {t('split.failed')}
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('split.cancel')}
          </Button>
          {ready?.blocked == null ? (
            <Button
              type="button"
              data-split-confirm=""
              loading={pending}
              disabled={ready === null || pending || offline}
              onClick={() => void onSplit()}
            >
              {t('split.confirm')}
            </Button>
          ) : null}
        </DialogFooter>
      </div>
    </DialogShell>
  );
}
