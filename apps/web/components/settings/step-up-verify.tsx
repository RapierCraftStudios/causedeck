'use client';
// Step-up verification (#305, #304 gate): `Confirm it is you` before an owner-only lifecycle action
// (export, delete or cancel a workspace deletion, delete the account). A passkey ceremony signs in
// again and Better Auth stamps the new session; an authenticator code re-verifies TOTP on the
// current session (`verifyTwoFactorAction`), which the auth hook stamps. Either counts for 10
// minutes. The code option shows only when the user has two-factor on. The parent retries the
// gated action after `onVerified`; nothing here is logged.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { useOnline } from './settings-offline-banner.tsx';

export type VerifyCode = (input: { code: string }) => Promise<Result<{ enabled: true }>>;

/** The passkey ceremony; `true` once the browser and server both accept it. */
export async function passkeyStepUp(): Promise<boolean> {
  const { authClient } = await import('../../lib/auth-client.ts');
  const result = await authClient.signIn.passkey();
  return !result.error;
}

/** True for an action failure that asks for step-up (`fieldErrors.stepUp`). */
export function needsStepUp(result: Result<unknown>): boolean {
  return !result.ok && result.error.code === 'FORBIDDEN' && !!result.error.fieldErrors?.stepUp;
}

export interface StepUpVerifyProps {
  twoFactorEnabled: boolean;
  verifyCode: VerifyCode;
  onVerified: () => void;
  /** Injected in tests; defaults to the Better Auth passkey sign-in. */
  passkey?: () => Promise<boolean>;
  verified?: boolean;
}

export function StepUpVerify({
  twoFactorEnabled,
  verifyCode,
  onVerified,
  passkey = passkeyStepUp,
  verified = false,
}: StepUpVerifyProps) {
  const t = useTranslations('lifecycle.stepUp');
  const online = useOnline();
  const id = useId();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<'passkey' | 'code' | null>(null);

  async function onPasskey() {
    setFailed(false);
    setPending('passkey');
    let ok = false;
    try {
      ok = await passkey();
    } catch {
      ok = false;
    }
    setPending(null);
    if (ok) onVerified();
    else setFailed(true);
  }

  async function onCode(event: SyntheticEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setCodeError(t('codeFormat'));
      return;
    }
    setPending('code');
    let result: Result<{ enabled: true }>;
    try {
      result = await verifyCode({ code });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(null);
    if (!result.ok) {
      setCodeError(t('wrongCode'));
      return;
    }
    setCode('');
    setCodeError(undefined);
    onVerified();
  }

  if (verified) {
    return (
      <Alert tone="success" data-slot="step-up-verified">
        {t('verified')}
      </Alert>
    );
  }

  return (
    <div data-slot="step-up" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{t('title')}</h3>
        <p className="text-ink-muted text-sm">{t('body')}</p>
      </div>
      {failed ? <Alert tone="danger">{t('passkeyFailed')}</Alert> : null}
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        disabled={!online || pending !== null}
        loading={pending === 'passkey'}
        onClick={() => void onPasskey()}
      >
        <KeyRound aria-hidden />
        {t('passkey')}
      </Button>
      {twoFactorEnabled ? (
        <form
          noValidate
          id={`${id}-code`}
          className="flex flex-col gap-2"
          onSubmit={(event) => void onCode(event)}
        >
          <Field label={t('code')} error={codeError}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, ''));
                setCodeError(undefined);
              }}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            className="self-start"
            disabled={!online || pending !== null}
            loading={pending === 'code'}
          >
            {t('verify')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
