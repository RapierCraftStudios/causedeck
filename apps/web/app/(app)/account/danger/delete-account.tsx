'use client';
// Account deletion (#305, wiring #303): the account page's danger section. `Delete account` opens a
// dialog with the consequences, `Confirm it is you` (passkey or authenticator code, #304) and the
// account email typed to confirm; `Delete account` is enabled only when both are done. A sole owner
// or staff account sees the server's explanation (transfer or delete the workspaces first). Once
// requested, the account deletion job anonymises the user and signs them out everywhere.
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
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { DangerZone } from '../../../../components/settings/danger-zone.tsx';
import { useOnline } from '../../../../components/settings/settings-offline-banner.tsx';
import {
  needsStepUp,
  StepUpVerify,
  type VerifyCode,
} from '../../../../components/settings/step-up-verify.tsx';
import type { Result } from '../../../../lib/safe-action.ts';
import type { AccountDeletionOutcome } from '../actions.ts';

export interface DeleteAccountProps {
  email: string;
  twoFactorEnabled: boolean;
  requestDeletion: (input: Record<string, never>) => Promise<Result<AccountDeletionOutcome>>;
  verifyCode: VerifyCode;
  /** Injected in tests. */
  passkey?: () => Promise<boolean>;
}

export function DeleteAccount({
  email,
  twoFactorEnabled,
  requestDeletion,
  verifyCode,
  passkey,
}: DeleteAccountProps) {
  const t = useTranslations('lifecycle.account');
  const tl = useTranslations('lifecycle');
  const online = useOnline();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [verified, setVerified] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);

  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  const canDelete = online && verified && matches && !pending;

  function reset() {
    setVerified(false);
    setTyped('');
    setError(null);
  }

  async function onDelete(event: SyntheticEvent) {
    event.preventDefault();
    if (!canDelete) return;
    setError(null);
    setPending(true);
    let result: Result<AccountDeletionOutcome>;
    try {
      result = await requestDeletion({});
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (result.ok) {
      setOpen(false);
      reset();
      setRequested(true);
      return;
    }
    if (needsStepUp(result)) {
      setVerified(false);
      return;
    }
    setError(result.error.code === 'CONFLICT' ? result.error.message : t('error'));
  }

  return (
    <DangerZone title={t('title')} description={t('description')} data-slot="delete-account">
      <div className="flex flex-col gap-3 py-3">
        <p className="text-ink-muted text-sm">{t('consequences')}</p>
        {requested ? (
          <Alert tone="success" role="status">
            {t('requested')}
          </Alert>
        ) : (
          <Button
            type="button"
            variant="destructive"
            className="self-start"
            disabled={!online}
            title={online ? undefined : tl('offline')}
            onClick={() => {
              setOpen(true);
            }}
          >
            {t('action')}
          </Button>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent data-slot="delete-account-dialog">
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('consequences')}</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}
          <StepUpVerify
            twoFactorEnabled={twoFactorEnabled}
            verifyCode={verifyCode}
            verified={verified}
            onVerified={() => {
              setVerified(true);
            }}
            {...(passkey === undefined ? {} : { passkey })}
          />
          <form noValidate id={`${id}-confirm`} onSubmit={(event) => void onDelete(event)}>
            <Field
              label={t('confirmLabel')}
              hint={t('confirmHint', { email })}
              error={typed.length > 0 && !matches ? t('mismatch') : undefined}
            >
              <Input
                type="email"
                autoComplete="off"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
              />
            </Field>
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('close')}
            </Button>
            <Button
              type="submit"
              form={`${id}-confirm`}
              variant="destructive"
              disabled={!canDelete}
              loading={pending}
            >
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DangerZone>
  );
}
