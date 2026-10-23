'use client';
// The undo dialog (#49): asks the engine what undoing would remove (`previewUndo`) and lists it,
// so "1 attachment, 2 tasks, listing details for 14 Nov" is never a surprise, then confirms
// (`undoActivity`, or `undoCapture` for everything from one capture). When the engine refuses
// (the lawyer confirmed or edited the result, or the 7-day window ended) the dialog shows the
// engine's reason and offers `Open the matter` instead of a dead end. The cascade is announced as a
// list; focus goes back to the item when the dialog closes (the feed's `onCloseAutoFocus`).
import type { ActivityView } from '@causedeck/core/automation';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Spinner } from '@causedeck/ui/spinner';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type {
  UndoItem,
  UndoOutcome,
  UndoPreviewResult,
} from '../../app/(app)/w/[slug]/activity/actions.ts';
import type { Result } from '../../lib/safe-action.ts';

export type UndoTarget =
  | { kind: 'activity'; item: ActivityView }
  | { kind: 'capture'; captureId: string; items: ActivityView[] };

export interface UndoDialogProps {
  workspaceId: string;
  workspaceSlug: string;
  target: UndoTarget;
  actions: {
    preview: (input: {
      workspaceId: string;
      activityId: string;
    }) => Promise<Result<UndoPreviewResult>>;
    undo: (input: { workspaceId: string; activityId: string }) => Promise<Result<UndoOutcome>>;
    undoCapture: (input: {
      workspaceId: string;
      captureId: string;
    }) => Promise<Result<UndoOutcome>>;
  };
  onUndone: (outcome: Extract<UndoOutcome, { status: 'undone' }>) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: 'previewError' | 'error' }
  | {
      kind: 'ready' | 'working';
      willRemove: UndoItem[];
      undoable: boolean;
      blockedReason: string | null;
      matterId: string | null;
    }
  | { kind: 'refused'; reason: string; matterId: string | null; expired: boolean };

function mergeItems(lists: readonly UndoItem[][]): UndoItem[] {
  const seen = new Map<string, UndoItem>();
  for (const list of lists) for (const item of list) seen.set(item.activityId, item);
  return [...seen.values()];
}

export function UndoDialog({
  workspaceId,
  workspaceSlug,
  target,
  actions,
  onUndone,
  onClose,
  onCloseAutoFocus,
}: UndoDialogProps) {
  const t = useTranslations('activity.undoDialog');
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const ids =
    target.kind === 'activity'
      ? [target.item.id]
      : target.items.filter((item) => item.undoable).map((item) => item.id);
  const idsKey = ids.join(',');

  useEffect(() => {
    // An object, not a `let`: the effect's cleanup flips it while the awaits below are pending.
    const run = { cancelled: false };
    void (async () => {
      const previews: UndoPreviewResult[] = [];
      for (const activityId of idsKey === '' ? [] : idsKey.split(',')) {
        try {
          const result = await actions.preview({ workspaceId, activityId });
          if (!result.ok) {
            if (!run.cancelled) setPhase({ kind: 'error', message: 'previewError' });
            return;
          }
          previews.push(result.data);
        } catch {
          if (!run.cancelled) setPhase({ kind: 'error', message: 'previewError' });
          return;
        }
      }
      if (run.cancelled) return;
      const undoable = previews.some((p) => p.undoable);
      setPhase({
        kind: 'ready',
        willRemove: mergeItems(
          previews.filter((p) => p.undoable || previews.length === 1).map((p) => p.willRemove),
        ),
        undoable,
        blockedReason: undoable
          ? null
          : (previews.find((p) => p.blockedReason !== null)?.blockedReason ?? null),
        matterId: previews.find((p) => p.matterId !== null)?.matterId ?? null,
      });
    })();
    return () => {
      run.cancelled = true;
    };
  }, [actions, workspaceId, idsKey]);

  const confirm = async () => {
    if (phase.kind !== 'ready') return;
    setPhase({ ...phase, kind: 'working' });
    try {
      const result =
        target.kind === 'activity'
          ? await actions.undo({ workspaceId, activityId: target.item.id })
          : await actions.undoCapture({ workspaceId, captureId: target.captureId });
      if (!result.ok) {
        setPhase({ kind: 'error', message: 'error' });
        return;
      }
      if (result.data.status === 'undone') {
        onUndone(result.data);
        return;
      }
      setPhase({
        kind: 'refused',
        reason: result.data.reason,
        matterId: result.data.matterId,
        expired: result.data.status === 'expired',
      });
    } catch {
      setPhase({ kind: 'error', message: 'error' });
    }
  };

  const matterHref = (matterId: string) =>
    `/w/${encodeURIComponent(workspaceSlug)}/matters/${matterId}`;
  const blocked =
    phase.kind === 'refused'
      ? { reason: phase.reason, matterId: phase.matterId, expired: phase.expired }
      : phase.kind === 'ready' && phase.blockedReason !== null
        ? { reason: phase.blockedReason, matterId: phase.matterId, expired: false }
        : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-slot="undo-dialog" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{target.kind === 'activity' ? t('title') : t('titleCapture')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {phase.kind === 'loading' ? (
          <p role="status" className="text-ink-muted flex items-center gap-2 text-sm">
            <Spinner aria-hidden="true" />
            {t('loading')}
          </p>
        ) : null}
        {phase.kind === 'error' ? (
          <p role="alert" className="text-danger text-sm">
            {t(phase.message)}
          </p>
        ) : null}
        {blocked === null ? null : (
          <div
            role="alert"
            data-slot="undo-refused"
            className="border-line bg-surface-sunken flex flex-col gap-2 rounded-md border p-3 text-sm"
          >
            <p className="font-medium">{blocked.expired ? t('expiredTitle') : t('refusedTitle')}</p>
            <p className="text-ink-muted">{blocked.reason}</p>
            {blocked.matterId === null ? null : (
              <a
                href={matterHref(blocked.matterId)}
                className="text-accent w-fit underline-offset-2 hover:underline"
              >
                {t('openMatter')}
              </a>
            )}
          </div>
        )}
        {phase.kind === 'ready' || phase.kind === 'working' ? (
          <div data-slot="undo-cascade">
            <p className="text-ink-muted mb-1 text-sm font-medium">{t('cascade')}</p>
            {phase.willRemove.length === 0 ? (
              <p className="text-ink-muted text-sm">{t('cascadeNone')}</p>
            ) : (
              <ul className="list-disc ps-5 text-sm">
                {phase.willRemove.map((item) => (
                  <li key={item.activityId}>{item.summary}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {blocked === null ? t('cancel') : t('close')}
          </Button>
          {phase.kind === 'ready' || phase.kind === 'working' ? (
            <Button
              type="button"
              disabled={phase.kind === 'working' || !phase.undoable}
              onClick={() => {
                void confirm();
              }}
            >
              {phase.kind === 'working'
                ? t('working')
                : target.kind === 'activity'
                  ? t('confirm')
                  : t('confirmCapture')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
