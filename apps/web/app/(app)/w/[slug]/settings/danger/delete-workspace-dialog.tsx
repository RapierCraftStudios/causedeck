'use client';
// Workspace deletion (#305, #31 design spec). `Delete workspace` opens a 3-step dialog: (1) the
// export reminder with a link to the export page and an acknowledgement, (2) `Confirm it is you`
// (passkey or authenticator code, #304) and (3) typing the workspace name. `Delete` is enabled only
// when all three are satisfied; if the server still finds the step-up stale, the dialog returns to
// step 2. After the request the page shows the cool-off state, and the shell shows the banner.
// `CancelDeletion` is the danger page's `Cancel deletion`: it asks for step-up when needed, then
// cancels. Offline, both are disabled with `Needs a connection`.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
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
import { toast } from '@causedeck/ui/sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import {
  needsStepUp,
  StepUpVerify,
  type VerifyCode,
} from '../../../../../../components/settings/step-up-verify.tsx';
import type { Result } from '../../../../../../lib/safe-action.ts';

import type { DeletionOutcome } from './actions.ts';

type Step = 'export' | 'verify' | 'name';
const STEPS: readonly Step[] = ['export', 'verify', 'name'];

export interface DeleteWorkspaceProps {
  workspaceId: string;
  workspaceName: string;
  exportHref: string;
  twoFactorEnabled: boolean;
  requestDeletion: (input: {
    workspaceId: string;
    confirmName: string;
  }) => Promise<Result<DeletionOutcome>>;
  verifyCode: VerifyCode;
  /** Injected in tests. */
  passkey?: () => Promise<boolean>;
}

/** The danger zone's `Delete workspace` button and its 3-step dialog. */
export function DeleteWorkspace({
  workspaceId,
  workspaceName,
  exportHref,
  twoFactorEnabled,
  requestDeletion,
  verifyCode,
  passkey,
}: DeleteWorkspaceProps) {
  const t = useTranslations('lifecycle');
  const online = useOnline();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('export');
  const [acknowledged, setAcknowledged] = useState(false);
  const [verified, setVerified] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setStep('export');
    setAcknowledged(false);
    setVerified(false);
    setName('');
    setNameError(undefined);
    setError(null);
  }

  const nameMatches = name.trim() === workspaceName;
  const canDelete = online && acknowledged && verified && nameMatches && !pending;

  async function onDelete(event: SyntheticEvent) {
    event.preventDefault();
    if (!canDelete) return;
    setError(null);
    setPending(true);
    let result: Result<DeletionOutcome>;
    try {
      result = await requestDeletion({ workspaceId, confirmName: name.trim() });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (result.ok) {
      setOpen(false);
      reset();
      toast(t('danger.requested'));
      router.refresh();
      return;
    }
    if (needsStepUp(result)) {
      setVerified(false);
      setStep('verify');
      return;
    }
    if (result.error.fieldErrors?.confirmName) {
      setNameError(t('danger.dialog.nameMismatch'));
      return;
    }
    setError(t('danger.dialog.error'));
  }

  const index = STEPS.indexOf(step);
  const canNext = step === 'export' ? acknowledged : step === 'verify' ? verified : false;

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        data-slot="danger-delete"
        disabled={!online}
        title={online ? undefined : t('offline')}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('danger.action')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent data-slot="delete-workspace-dialog" data-step={step}>
          <DialogHeader>
            <DialogTitle>{t('danger.dialog.title')}</DialogTitle>
            <DialogDescription>
              {t('danger.dialog.step', { current: index + 1, total: STEPS.length })}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}

          {step === 'export' ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-base font-semibold">{t('danger.dialog.exportTitle')}</h3>
              <p className="text-ink-muted text-sm">{t('danger.dialog.exportBody')}</p>
              <Link
                href={exportHref}
                className="text-accent self-start text-sm font-medium underline-offset-2 hover:underline"
              >
                {t('danger.dialog.exportLink')}
              </Link>
              <div className="flex items-start gap-2">
                <Checkbox
                  id={`${id}-ack`}
                  checked={acknowledged}
                  onCheckedChange={(checked) => {
                    setAcknowledged(checked === true);
                  }}
                />
                <label htmlFor={`${id}-ack`} className="text-sm">
                  {t('danger.dialog.exportAck')}
                </label>
              </div>
            </div>
          ) : null}

          {step === 'verify' ? (
            <StepUpVerify
              twoFactorEnabled={twoFactorEnabled}
              verifyCode={verifyCode}
              verified={verified}
              onVerified={() => {
                setVerified(true);
              }}
              {...(passkey === undefined ? {} : { passkey })}
            />
          ) : null}

          {step === 'name' ? (
            <form noValidate id={`${id}-name`} onSubmit={(event) => void onDelete(event)}>
              <Field
                label={t('danger.dialog.nameLabel')}
                hint={t('danger.dialog.nameHint', { name: workspaceName })}
                error={nameError}
              >
                <Input
                  autoComplete="off"
                  spellCheck={false}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameError(undefined);
                  }}
                />
              </Field>
            </form>
          ) : null}

          <DialogFooter>
            {index > 0 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setStep(STEPS[index - 1] ?? 'export');
                }}
              >
                {t('danger.dialog.back')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t('danger.dialog.close')}
              </Button>
            )}
            {step === 'name' ? (
              <Button
                type="submit"
                form={`${id}-name`}
                variant="destructive"
                disabled={!canDelete}
                loading={pending}
              >
                {t('danger.dialog.delete')}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={!canNext}
                onClick={() => {
                  setStep(STEPS[index + 1] ?? 'name');
                }}
              >
                {t('danger.dialog.next')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface CancelDeletionProps {
  workspaceId: string;
  jobId: string;
  twoFactorEnabled: boolean;
  cancelDeletion: (input: {
    workspaceId: string;
    jobId: string;
  }) => Promise<Result<DeletionOutcome>>;
  verifyCode: VerifyCode;
  passkey?: () => Promise<boolean>;
}

/** `Cancel deletion` on the danger page: any owner, after a fresh step-up. */
export function CancelDeletion({
  workspaceId,
  jobId,
  twoFactorEnabled,
  cancelDeletion,
  verifyCode,
  passkey,
}: CancelDeletionProps) {
  const t = useTranslations('lifecycle');
  const online = useOnline();
  const router = useRouter();
  const [stepUp, setStepUp] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCancel() {
    setError(null);
    setPending(true);
    let result: Result<DeletionOutcome>;
    try {
      result = await cancelDeletion({ workspaceId, jobId });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (result.ok) {
      setStepUp(false);
      toast(t('danger.cancelled'));
      router.refresh();
      return;
    }
    if (needsStepUp(result)) {
      setStepUp(true);
      return;
    }
    setError(t('danger.cancelError'));
  }

  return (
    <div className="flex flex-col gap-3" data-slot="cancel-deletion">
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {stepUp ? (
        <StepUpVerify
          twoFactorEnabled={twoFactorEnabled}
          verifyCode={verifyCode}
          onVerified={() => void onCancel()}
          {...(passkey === undefined ? {} : { passkey })}
        />
      ) : null}
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        disabled={!online || pending}
        loading={pending}
        title={online ? undefined : t('offline')}
        onClick={() => void onCancel()}
      >
        {t('danger.cancel')}
      </Button>
    </div>
  );
}
