'use client';
// Delegation client pieces (#63): the tomorrow plan's rows with an assignee picker, bulk "Accept all
// suggestions" behind a confirm dialog, offline queueing ("Will sync"), and the owner's live outcome
// strip (4 s poll while the tab is visible, plus a toast per new confirmation).
import {
  AssigneeChip,
  AssignmentRow,
  OutcomesStrip,
  type AssigneeOption,
  type AssignmentFlag,
} from '@causedeck/ui/patterns/delegation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@causedeck/ui/alert-dialog';
import { Button } from '@causedeck/ui/button';
import { toast } from '@causedeck/ui/sonner';
import type { AssignInput } from '@causedeck/validators';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Result } from '../../../../../lib/safe-action.ts';
import type { AssignedView, OutcomesLiveView } from '../tomorrow/plan/actions.ts';

/** Under the 5 s budget (R5): a confirmed outcome shows on the owner's board within one tick. */
export const OUTCOMES_POLL_MS = 4_000;

export interface PlanRow {
  listingId: string;
  title: string;
  detail: string;
  assigneeId: string | null;
  flag: AssignmentFlag | undefined;
  capacity: AssignInput['capacity'];
  suggestion?: { memberId: string; reason: string } | undefined;
}

type AssignFn = (input: {
  workspaceId: string;
  listingId: string;
  memberId: string;
  capacity: PlanRow['capacity'];
}) => Promise<Result<AssignedView>>;

export interface DelegatePlanProps {
  workspaceId: string;
  rows: readonly PlanRow[];
  members: readonly AssigneeOption[];
  /** Without `appearance.assign` the plan is read-only. */
  canAssign: boolean;
  actions: {
    assign: AssignFn;
    acceptAll: (input: {
      workspaceId: string;
      suggestions: { listingId: string; memberId: string; capacity: PlanRow['capacity'] }[];
    }) => Promise<Result<{ accepted: AssignedView[] }>>;
  };
}

interface Queued {
  listingId: string;
  memberId: string;
}

/** The plan: unassigned and clashing rows come first (the page sorts), each with a picker. */
export function DelegatePlan({
  workspaceId,
  rows,
  members,
  canAssign,
  actions,
}: DelegatePlanProps) {
  const t = useTranslations('delegation');
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [queued, setQueued] = useState<Queued[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameOf = useCallback(
    (id: string) => members.find((m) => m.id === id)?.name ?? '',
    [members],
  );
  const capacityOf = useCallback(
    (listingId: string) => rows.find((r) => r.listingId === listingId)?.capacity ?? 'arguing',
    [rows],
  );

  const send = useCallback(
    async (listingId: string, memberId: string) => {
      const result = await actions.assign({
        workspaceId,
        listingId,
        memberId,
        capacity: capacityOf(listingId),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setError(null);
      setAssigned((prev) => ({ ...prev, [listingId]: result.data.memberId }));
      const { previousMemberId } = result.data;
      // Last writer visible: if someone else held it meanwhile, say so.
      if (previousMemberId !== null && previousMemberId !== memberId) {
        const row = rows.find((r) => r.listingId === listingId);
        if (row?.assigneeId !== null && previousMemberId !== row?.assigneeId) {
          setNotice(t('conflictNotice', { name: nameOf(previousMemberId) }));
        }
      }
      toast.success(t('assigned', { name: nameOf(memberId) }));
    },
    [actions, workspaceId, rows, capacityOf, nameOf, t],
  );

  const assign = (listingId: string, memberId: string) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setQueued((prev) => [
        ...prev.filter((q) => q.listingId !== listingId),
        { listingId, memberId },
      ]);
      return;
    }
    void send(listingId, memberId);
  };

  useEffect(() => {
    const flush = () => {
      setQueued((prev) => {
        for (const q of prev) void send(q.listingId, q.memberId);
        return [];
      });
    };
    window.addEventListener('online', flush);
    return () => {
      window.removeEventListener('online', flush);
    };
  }, [send]);

  const suggested = rows.filter(
    (r) => r.suggestion !== undefined && assigned[r.listingId] === undefined,
  );
  const acceptAll = async () => {
    const result = await actions.acceptAll({
      workspaceId,
      suggestions: suggested.flatMap((r) =>
        r.suggestion === undefined
          ? []
          : [{ listingId: r.listingId, memberId: r.suggestion.memberId, capacity: r.capacity }],
      ),
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setAssigned((prev) => ({
      ...prev,
      ...Object.fromEntries(result.data.accepted.map((a) => [a.listingId, a.memberId])),
    }));
  };

  return (
    <div className="flex flex-col gap-3">
      {canAssign && suggested.length > 0 ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" size="lg" className="self-start">
              {t('acceptAll')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('acceptAllTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('acceptAllBody', { count: suggested.length })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void acceptAll()}>{t('confirm')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {notice === null ? null : (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => {
          const current = assigned[row.listingId] ?? row.assigneeId;
          return (
            <AssignmentRow
              key={row.listingId}
              title={row.title}
              detail={row.detail}
              members={members}
              assigneeId={current}
              flag={assigned[row.listingId] === undefined ? row.flag : undefined}
              sync={queued.some((q) => q.listingId === row.listingId) ? 'queued' : 'synced'}
              suggestion={assigned[row.listingId] === undefined ? row.suggestion : undefined}
              labels={{
                assignee: t('assignee'),
                assign: t('assign'),
                choose: t('choose'),
                unassigned: t('unassigned'),
                clash: t('clash'),
                willSync: t('willSync'),
                suggestion: (name) => t('suggested', { name }),
              }}
              disabled={!canAssign}
              onAssign={(memberId) => {
                assign(row.listingId, memberId);
              }}
            />
          );
        })}
      </ul>
    </div>
  );
}

/** Who holds an item, as a chip on the board. */
export function AssigneeLabel({ name }: { name?: string | undefined }) {
  const t = useTranslations('delegation');
  return <AssigneeChip name={name} unassignedLabel={t('unassigned')} />;
}

export interface OutcomesLiveStripProps {
  workspaceId: string;
  date: string;
  initial: OutcomesLiveView;
  poll: (input: { workspaceId: string; date: string }) => Promise<Result<OutcomesLiveView>>;
  intervalMs?: number;
}

/** The owner's outcome strip: polls while the tab is visible and toasts each new confirmation. */
export function OutcomesLiveStrip({
  workspaceId,
  date,
  initial,
  poll,
  intervalMs = OUTCOMES_POLL_MS,
}: OutcomesLiveStripProps) {
  const t = useTranslations('delegation');
  const [view, setView] = useState(initial);
  const seen = useRef(initial);

  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const result = await poll({ workspaceId, date });
      if (!result.ok) return;
      for (const next of result.data.members) {
        const before = seen.current.members.find((m) => m.memberId === next.memberId);
        if (next.outcomesIn > (before?.outcomesIn ?? 0)) {
          toast.success(t('outcomes.toast', { name: next.name }));
        }
      }
      seen.current = result.data;
      setView(result.data);
    };
    const id = window.setInterval(() => void tick(), intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [poll, workspaceId, date, intervalMs, t]);

  if (view.members.length === 0) return null;
  return (
    <OutcomesStrip
      members={view.members}
      label={t('outcomes.label')}
      format={(m) => t('outcomes.member', { name: m.name, done: m.outcomesIn, total: m.total })}
    />
  );
}
