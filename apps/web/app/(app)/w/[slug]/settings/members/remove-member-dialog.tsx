'use client';
// `Remove from workspace` (#181): a destructive confirm that needs no typing but lists what happens.
// When the member holds open tasks or obligations (`openWorkAction`), choosing who takes them over
// is required before the confirm button enables; the offboarding service then reassigns them,
// ends the member's sessions in this workspace and marks the membership removed.
import { Alert } from '@causedeck/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@causedeck/ui/alert-dialog';
import { Field } from '@causedeck/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import { Skeleton } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { ActionErrorCode, Result } from '../../../../../../lib/safe-action.ts';

import type { OpenWork } from './actions.ts';
import { errorKeyFor, useOnline } from './role-select.tsx';

export interface RemoveTarget {
  memberId: string;
  name: string;
}

export interface RemoveMemberActions {
  openWork: (input: { workspaceId: string; memberId: string }) => Promise<Result<OpenWork>>;
  removeMember: (input: {
    workspaceId: string;
    memberId: string;
    reassignTo?: string | undefined;
  }) => Promise<Result<unknown>>;
}

export interface RemoveMemberDialogProps {
  workspace: { id: string; name: string };
  member: RemoveTarget;
  /** Other active members who can take over open work. */
  candidates: readonly { memberId: string; name: string }[];
  actions: RemoveMemberActions;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful removal (the list animates the row out, then refreshes). */
  onRemoved: (memberId: string) => void;
}

export function RemoveMemberDialog({
  workspace,
  member,
  candidates,
  actions,
  onOpenChange,
  onRemoved,
}: RemoveMemberDialogProps) {
  const t = useTranslations('members');
  const online = useOnline();
  const [open, setOpen] = useState<number | null>(null);
  const [reassignTo, setReassignTo] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    actions
      .openWork({ workspaceId: workspace.id, memberId: member.memberId })
      .then((result) => {
        if (live) setOpen(result.ok ? result.data.count : 0);
      })
      .catch(() => {
        if (live) setOpen(0);
      });
    return () => {
      live = false;
    };
  }, [actions, workspace.id, member.memberId]);

  const needsReassign = open !== null && open > 0;
  const ready = open !== null && (!needsReassign || reassignTo !== undefined);

  function fail(code: ActionErrorCode) {
    if (code === 'VALIDATION' && needsReassign) setError(t('remove.reassignRequired'));
    else setError(t(`errors.${errorKeyFor(code)}`));
  }

  async function confirm() {
    setError(null);
    if (!navigator.onLine) {
      setError(t('errors.offline'));
      return;
    }
    if (needsReassign && reassignTo === undefined) {
      setError(t('remove.reassignRequired'));
      return;
    }
    setPending(true);
    try {
      const result = await actions.removeMember({
        workspaceId: workspace.id,
        memberId: member.memberId,
        reassignTo: needsReassign ? reassignTo : undefined,
      });
      setPending(false);
      if (result.ok) {
        onRemoved(member.memberId);
        onOpenChange(false);
      } else {
        fail(result.error.code);
      }
    } catch {
      setPending(false);
      setError(t('errors.generic'));
    }
  }

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent data-dialog="remove-member">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('remove.title', { name: member.name, workspace: workspace.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('remove.consequencesTitle')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="text-ink-muted list-disc space-y-1 ps-5 text-sm">
          <li>{t('remove.access', { name: member.name, workspace: workspace.name })}</li>
          <li>{t('remove.sessions')}</li>
          <li>{t('remove.otherWorkspaces')}</li>
          {needsReassign ? <li>{t('remove.openWork', { count: open })}</li> : null}
        </ul>
        {open === null ? (
          <div className="flex flex-col gap-1.5" aria-busy="true">
            <span className="sr-only">{t('remove.checking')}</span>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : null}
        {needsReassign ? (
          <Field label={t('remove.reassignLabel')} required>
            <Select
              value={reassignTo}
              onValueChange={(value) => {
                setError(null);
                setReassignTo(value);
              }}
              disabled={pending}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('remove.reassignPlaceholder')} />
              </SelectTrigger>
              {/* Above the dialog overlay (z-overlay) and the dialog itself (z-modal). */}
              <SelectContent className="z-popover">
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.memberId} value={candidate.memberId}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('remove.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!online || !ready || pending}
            aria-busy={pending || undefined}
            onClick={(event) => {
              // Keep the dialog open until the removal resolves; errors render inline.
              event.preventDefault();
              void confirm();
            }}
          >
            {pending ? t('remove.removing') : t('remove.submit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
