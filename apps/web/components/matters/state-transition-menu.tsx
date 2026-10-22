'use client';
// The state-transition menu of a proceeding row (#392, ADR 0016). It lists only `transitions`,
// which the server worked out from `PROCEEDING_TRANSITIONS` for members who may write, so an
// illegal transition is never rendered (with none, there is no menu at all). Choosing a state
// opens a short form (react-hook-form + zod): `numbered` needs the number and year the registry
// gave, a reopen (`disposed` -> `numbered`) also needs a reason, and `defects` asks for an optional
// cure deadline. It calls `transitionProceedingAction` (the state machine decides again), announces
// the move and refreshes. `Esc` closes the form and focus returns to the menu button.
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@causedeck/ui/dropdown-menu';
import { Form, FormField, useZodForm } from '@causedeck/ui/form';
import { Input } from '@causedeck/ui/input';
import { ArrowRightLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { z } from 'zod';

import type { ProceedingState } from '../../lib/matters/proceedings-view.ts';
import type { Result } from '../../lib/safe-action.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';

export interface TransitionInput {
  workspaceId: string;
  proceedingId: string;
  to: ProceedingState;
  reason?: string;
  number?: string;
  year?: number;
  cureDeadline?: string;
}

export type TransitionProceedingAction = (input: TransitionInput) => Promise<Result<unknown>>;

export interface StateTransitionMenuProps {
  workspaceId: string;
  proceedingId: string;
  label: string;
  state: ProceedingState;
  transitions: readonly ProceedingState[];
  action: TransitionProceedingAction;
  offline?: boolean;
  /** The tree's roving tabindex: -1 outside the active row. */
  tabIndex?: number;
}

interface Draft {
  number: string;
  year: string;
  reason: string;
  cureDeadline: string;
}

const EMPTY: Draft = { number: '', year: '', reason: '', cureDeadline: '' };

/** The form's schema for a move from `from` to `to`. */
export function transitionSchema(
  from: ProceedingState,
  to: ProceedingState,
  messages: { numberRequired: string; reasonRequired: string; invalidYear: string },
) {
  return z
    .object({
      number: z.string(),
      year: z.string(),
      reason: z.string(),
      cureDeadline: z.string(),
    })
    .superRefine((value, ctx) => {
      if (to === 'numbered') {
        if (value.number.trim() === '') {
          ctx.addIssue({ code: 'custom', path: ['number'], message: messages.numberRequired });
        }
        const year = Number(value.year);
        if (value.year.trim() === '') {
          ctx.addIssue({ code: 'custom', path: ['year'], message: messages.numberRequired });
        } else if (!Number.isInteger(year) || year < 1800 || year > 2200) {
          ctx.addIssue({ code: 'custom', path: ['year'], message: messages.invalidYear });
        }
      }
      if (from === 'disposed' && value.reason.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['reason'], message: messages.reasonRequired });
      }
    });
}

/** The action input for a validated draft: only the fields the move takes. */
export function transitionInput(
  base: { workspaceId: string; proceedingId: string },
  from: ProceedingState,
  to: ProceedingState,
  draft: Draft,
): TransitionInput {
  return {
    ...base,
    to,
    ...(to === 'numbered' ? { number: draft.number.trim(), year: Number(draft.year) } : {}),
    ...(from === 'disposed' ? { reason: draft.reason.trim() } : {}),
    ...(to === 'defects' && draft.cureDeadline !== '' ? { cureDeadline: draft.cureDeadline } : {}),
  };
}

export function StateTransitionMenu({
  workspaceId,
  proceedingId,
  label,
  state,
  transitions,
  action,
  offline = false,
  tabIndex,
}: StateTransitionMenuProps) {
  const t = useTranslations('matters.workspace');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<ProceedingState | null>(null);
  if (transitions.length === 0) return null;
  const stateLabel = (value: ProceedingState) => t(`proceedings.states.${value}`);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            tabIndex={tabIndex}
            variant="ghost"
            size="sm"
            data-transition-menu={proceedingId}
            aria-label={t('proceedingsTab.transition.menu', { label })}
            disabled={offline}
          >
            <ArrowRightLeft aria-hidden="true" className="size-4" />
            <span className="max-md:sr-only">{stateLabel(state)}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {transitions.map((to) => (
            <DropdownMenuItem
              key={to}
              data-transition-to={to}
              onSelect={() => {
                setTarget(to);
              }}
            >
              {t('proceedingsTab.transition.to', { state: stateLabel(to) })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {target === null ? null : (
        <TransitionDialog
          key={target}
          workspaceId={workspaceId}
          proceedingId={proceedingId}
          label={label}
          from={state}
          to={target}
          action={action}
          offline={offline}
          onClose={() => {
            setTarget(null);
          }}
          returnFocus={() => triggerRef.current}
        />
      )}
    </>
  );
}

interface TransitionDialogProps {
  workspaceId: string;
  proceedingId: string;
  label: string;
  from: ProceedingState;
  to: ProceedingState;
  action: TransitionProceedingAction;
  offline: boolean;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}

function TransitionDialog({
  workspaceId,
  proceedingId,
  label,
  from,
  to,
  action,
  offline,
  onClose,
  returnFocus,
}: TransitionDialogProps) {
  const t = useTranslations('matters.workspace');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const [failure, setFailure] = useState<string | null>(null);
  const schema = transitionSchema(from, to, {
    numberRequired: t('proceedingsTab.transition.numberRequired'),
    reasonRequired: t('proceedingsTab.transition.reasonRequired'),
    invalidYear: t('proceedingsTab.form.invalidYear'),
  });
  const form = useZodForm(schema, { defaultValues: EMPTY });
  const stateLabel = t(`proceedings.states.${to}`);
  const pending = form.formState.isSubmitting;

  async function onSubmit(draft: Draft) {
    if (offline) return;
    setFailure(null);
    let result: Result<unknown>;
    try {
      result = await action(transitionInput({ workspaceId, proceedingId }, from, to, draft));
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    if (!result.ok) {
      setFailure(
        result.error.code === 'CONFLICT'
          ? t('proceedingsTab.transition.stale')
          : t('proceedingsTab.transition.failed'),
      );
      if (result.error.code === 'CONFLICT') router.refresh();
      return;
    }
    announce(t('proceedingsTab.transition.announce', { label, state: stateLabel }));
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-slot="transition-dialog"
        data-transition-dialog={to}
        onCloseAutoFocus={(event) => {
          const element = returnFocus();
          if (element === null) return;
          event.preventDefault();
          element.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('proceedingsTab.transition.title', { label, state: stateLabel })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('proceedingsTab.transition.title', { label, state: stateLabel })}
          </DialogDescription>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="flex flex-col gap-4">
          {to === 'numbered' ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField
                name="number"
                label={t('proceedingsTab.transition.number')}
                required
                render={({ field }) => <Input {...field} autoComplete="off" />}
              />
              <FormField
                name="year"
                label={t('proceedingsTab.transition.year')}
                required
                render={({ field }) => <Input {...field} inputMode="numeric" autoComplete="off" />}
              />
            </div>
          ) : null}
          {from === 'disposed' ? (
            <FormField
              name="reason"
              label={t('proceedingsTab.transition.reason')}
              required
              render={({ field }) => <Input {...field} autoComplete="off" />}
            />
          ) : null}
          {to === 'defects' ? (
            <FormField
              name="cureDeadline"
              label={t('proceedingsTab.transition.cureDeadline')}
              render={({ field }) => <Input {...field} type="date" />}
            />
          ) : null}
          {offline ? (
            <Alert tone="warning" role="status">
              {t('offlineAction')}
            </Alert>
          ) : null}
          {failure === null ? null : (
            <Alert tone="danger" role="alert">
              {failure}
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('proceedingsTab.transition.cancel')}
            </Button>
            <Button
              type="submit"
              data-transition-confirm=""
              loading={pending}
              disabled={pending || offline}
            >
              {t('proceedingsTab.transition.confirm')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
