'use client';
// Roles on the members page (#181): the role pill, the labelled role select, and the `Change role`
// dialog. Picking `Owner` is not a role change but an ownership transfer, so the dialog moves to a
// two-step confirm (consequences, then type the workspace slug) instead of calling `changeRole`.
import { Alert } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import { toast } from '@causedeck/ui/sonner';
import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore, type SyntheticEvent } from 'react';

import type { ActionErrorCode, Result } from '../../../../../../lib/safe-action.ts';
import type { Role } from '../../../../../../lib/workspace-context.ts';

import type { TransferPlan } from './actions.ts';

/** Most to least privileged, the order roles are listed in. */
export const ROLE_ORDER: readonly Role[] = ['owner', 'advocate', 'junior', 'clerk', 'viewer'];

/** Roles each role may invite (mirrors `INVITABLE_ROLES` in `@causedeck/core/workspaces`). */
export const INVITABLE: Record<Role, readonly Role[]> = {
  owner: ['advocate', 'junior', 'clerk', 'viewer'],
  advocate: ['junior', 'clerk', 'viewer'],
  junior: [],
  clerk: [],
  viewer: [],
};

/** Semantic soft tokens per role; the pill always carries the role name, never colour alone. */
const ROLE_PILL: Record<
  Role,
  { tone: 'neutral' | 'accent' | 'info' | 'warning'; className?: string }
> = {
  owner: { tone: 'neutral', className: 'border-seal bg-seal/15 text-ink' },
  advocate: { tone: 'accent' },
  junior: { tone: 'info' },
  clerk: { tone: 'warning' },
  viewer: { tone: 'neutral' },
};

export function RolePill({ role }: { role: Role }) {
  const t = useTranslations('members.roles');
  const pill = ROLE_PILL[role];
  return (
    <Badge tone={pill.tone} className={pill.className} data-role={role}>
      {t(role)}
    </Badge>
  );
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** `navigator.onLine`, live; `true` on the server. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export type MembersErrorKey =
  'lastOwner' | 'forbidden' | 'notFound' | 'validation' | 'signedOut' | 'offline' | 'generic';

/** A failed action's code as a `members.errors.*` key; `CONFLICT` here is the last-owner guard. */
export function errorKeyFor(code: ActionErrorCode): MembersErrorKey {
  switch (code) {
    case 'CONFLICT':
      return 'lastOwner';
    case 'FORBIDDEN':
      return 'forbidden';
    case 'NOT_FOUND':
      return 'notFound';
    case 'VALIDATION':
      return 'validation';
    case 'UNAUTHENTICATED':
      return 'signedOut';
    default:
      return 'generic';
  }
}

export interface RoleSelectProps {
  value: Role;
  onValueChange: (role: Role) => void;
  label: string;
  hint?: string | undefined;
  disabled?: boolean | undefined;
}

/** A labelled select over the five roles. */
export function RoleSelect({ value, onValueChange, label, hint, disabled }: RoleSelectProps) {
  const t = useTranslations('members');
  return (
    <Field label={label} hint={hint} disabled={disabled}>
      <Select
        value={value}
        onValueChange={(next) => {
          onValueChange(next as Role);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        {/* Above the dialog overlay (z-overlay) and the dialog itself (z-modal). */}
        <SelectContent className="z-popover">
          {ROLE_ORDER.map((role) => (
            <SelectItem key={role} value={role}>
              {t(`roles.${role}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export interface RoleTarget {
  memberId: string;
  userId: string;
  name: string;
  role: Role;
}

export interface ChangeRoleActions {
  changeRole: (input: {
    workspaceId: string;
    memberId: string;
    role: Role;
  }) => Promise<Result<unknown>>;
  prepareTransfer: (input: {
    workspaceId: string;
    newOwnerUserId: string;
  }) => Promise<Result<TransferPlan>>;
  confirmTransfer: (input: {
    workspaceId: string;
    newOwnerUserId: string;
    confirmation: string;
  }) => Promise<Result<unknown>>;
}

export interface ChangeRoleDialogProps {
  workspace: { id: string; slug: string; name: string };
  member: RoleTarget;
  /** `transfer` opens straight on ownership transfer (the row menu's `Transfer ownership`). */
  intent: 'role' | 'transfer';
  actions: ChangeRoleActions;
  onOpenChange: (open: boolean) => void;
}

type Step = { kind: 'role' } | { kind: 'transfer'; plan: TransferPlan };

/** `Change role`, and the two-step ownership transfer it leads to when `Owner` is picked. */
export function ChangeRoleDialog({
  workspace,
  member,
  intent,
  actions,
  onOpenChange,
}: ChangeRoleDialogProps) {
  const t = useTranslations('members');
  const online = useOnline();
  const [role, setRole] = useState<Role>(intent === 'transfer' ? 'owner' : member.role);
  const [step, setStep] = useState<Step>({ kind: 'role' });
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(code: ActionErrorCode) {
    setError(t(`errors.${errorKeyFor(code)}`));
  }

  async function run<T>(call: () => Promise<Result<T>>, onDone: (data: T) => void) {
    setError(null);
    if (!navigator.onLine) {
      setError(t('errors.offline'));
      return;
    }
    setPending(true);
    try {
      const result = await call();
      if (result.ok) onDone(result.data);
      else fail(result.error.code);
    } catch {
      setError(t('errors.generic'));
    }
    setPending(false);
  }

  function onSubmitRole(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (role === 'owner' && member.role !== 'owner') {
      void run(
        () => actions.prepareTransfer({ workspaceId: workspace.id, newOwnerUserId: member.userId }),
        (plan) => {
          setTyped('');
          setStep({ kind: 'transfer', plan });
        },
      );
      return;
    }
    if (role === member.role) {
      onOpenChange(false);
      return;
    }
    void run(
      () => actions.changeRole({ workspaceId: workspace.id, memberId: member.memberId, role }),
      () => {
        toast(t('changeRole.success', { name: member.name, role: t(`roles.${role}`) }));
        onOpenChange(false);
      },
    );
  }

  function onSubmitTransfer(event: SyntheticEvent<HTMLFormElement>, plan: TransferPlan) {
    event.preventDefault();
    if (typed.trim() !== plan.confirmation) {
      setError(t('transfer.confirmMismatch'));
      return;
    }
    void run(
      () =>
        actions.confirmTransfer({
          workspaceId: workspace.id,
          newOwnerUserId: member.userId,
          confirmation: typed.trim(),
        }),
      () => {
        toast(t('transfer.success', { name: member.name, workspace: workspace.name }));
        onOpenChange(false);
      },
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-dialog="change-role" className="max-h-[85dvh] overflow-y-auto">
        {step.kind === 'role' ? (
          <form onSubmit={onSubmitRole} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t('changeRole.title')}</DialogTitle>
              <DialogDescription>
                {t('changeRole.description', { name: member.name, workspace: workspace.name })}
              </DialogDescription>
            </DialogHeader>
            <RoleSelect
              value={role}
              onValueChange={(next) => {
                setError(null);
                setRole(next);
              }}
              label={t('changeRole.label', { name: member.name })}
              hint={
                role === 'owner' && member.role !== 'owner' ? t('changeRole.ownerHint') : undefined
              }
              disabled={pending}
            />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {t('changeRole.cancel')}
              </Button>
              <Button
                type="submit"
                loading={pending}
                disabled={!online}
                labels={{ loading: t('changeRole.saving') }}
              >
                {role === 'owner' && member.role !== 'owner'
                  ? t('changeRole.continue')
                  : t('changeRole.submit')}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              onSubmitTransfer(event, step.plan);
            }}
            className="grid gap-4"
            noValidate
          >
            <DialogHeader>
              <DialogTitle>{t('transfer.title', { name: member.name })}</DialogTitle>
              <DialogDescription>
                {t('transfer.description', { name: member.name, workspace: workspace.name })}
              </DialogDescription>
            </DialogHeader>
            <ul className="text-ink-muted list-disc space-y-1 ps-5 text-sm">
              <li>{t('transfer.consequences.newOwner', { name: member.name })}</li>
              <li>{t('transfer.consequences.you')}</li>
              <li>{t('transfer.consequences.undo')}</li>
            </ul>
            <Field label={t('transfer.confirmLabel', { slug: step.plan.confirmation })} required>
              <Input
                name="confirmation"
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setError(null);
                  setTyped(event.target.value);
                }}
                disabled={pending}
              />
            </Field>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setStep({ kind: 'role' });
                }}
              >
                {t('transfer.back')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                loading={pending}
                disabled={!online || typed.trim() !== step.plan.confirmation}
                labels={{ loading: t('transfer.transferring') }}
              >
                {t('transfer.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
