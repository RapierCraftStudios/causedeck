'use client';
// Two-factor setup (#289, #25 design spec): the account's 2FA status with `Set up`, which opens a
// 3-step dialog: scan the QR code (or type the key), verify a 6-digit code, then save the backup
// codes (selectable, `Copy` and `Download`, shown once). Focus moves to each step as it appears
// (the code field on the verify step) and returns to `Set up` when the dialog closes. The QR code
// sits on a white surface with its quiet zone in both themes. The secret and the codes live only
// in this component's state and are dropped when the dialog closes; nothing is logged.
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
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { toast } from '@causedeck/ui/sonner';
import { Copy, Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useId, useRef, useState, type SyntheticEvent } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { useOnline } from './settings-offline-banner.tsx';

export interface TwoFactorSetupData {
  qr: string;
  secret: string;
  backupCodes: string[];
}

export interface TwoFactorActions {
  enableTwoFactor: (input: Record<string, never>) => Promise<Result<TwoFactorSetupData>>;
  verifyTwoFactor: (input: { code: string }) => Promise<Result<{ enabled: true }>>;
}

type Step = 'scan' | 'verify' | 'codes';
const STEPS: readonly Step[] = ['scan', 'verify', 'codes'];

export const BACKUP_CODES_FILE = 'causedeck-backup-codes.txt';

/** Save the backup codes as a text file, one per line. */
function downloadCodes(codes: readonly string[]): void {
  const blob = new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = BACKUP_CODES_FILE;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface TwoFactorSetupDialogProps extends TwoFactorActions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the first code verifies (2FA is on). */
  onEnabled: () => void;
}

export function TwoFactorSetupDialog({
  open,
  onOpenChange,
  onEnabled,
  enableTwoFactor,
  verifyTwoFactor,
}: TwoFactorSetupDialogProps) {
  const t = useTranslations('settings.account.twoFactor.dialog');
  const online = useOnline();
  const id = useId();
  const [step, setStep] = useState<Step>('scan');
  const [setup, setSetup] = useState<TwoFactorSetupData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Verifying rotates the session cookie, which makes Next re-render the page and hand this
  // component new server-action references. The effect below must not re-run for that (it would
  // reset the dialog to step 1 and ask for a second secret), so it reads the action through an
  // effect event and depends only on `open` and `attempt`.
  const startSetup = useEffectEvent(() => enableTwoFactor({}));

  // A fresh secret each time the dialog opens; everything is dropped when it closes.
  useEffect(() => {
    if (!open) return;
    let live = true;
    startSetup()
      .then((result) => {
        if (!live) return;
        if (result.ok) setSetup(result.data);
        else setLoadError(true);
      })
      .catch(() => {
        if (live) setLoadError(true);
      });
    return () => {
      live = false;
      setSetup(null);
      setLoadError(false);
      setStep('scan');
      setCode('');
      setCodeError(undefined);
    };
  }, [open, attempt]);

  // Focus follows the step: the code field to type into, otherwise the step heading.
  useEffect(() => {
    if (!open || !setup) return;
    if (step === 'verify') codeRef.current?.focus();
    else headingRef.current?.focus();
  }, [open, setup, step]);

  async function onVerify(event: SyntheticEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setCodeError(t('errors.code'));
      return;
    }
    setPending(true);
    let result: Result<{ enabled: true }>;
    try {
      result = await verifyTwoFactor({ code });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      setCodeError(
        result.error.code === 'VALIDATION' ? t('errors.wrongCode') : t('errors.generic'),
      );
      return;
    }
    setStep('codes');
    onEnabled();
  }

  async function onCopy(codes: readonly string[]) {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast(t('copied'));
    } catch {
      toast(t('errors.copy'));
    }
  }

  const index = STEPS.indexOf(step) + 1;
  const stepTitle = { scan: t('scanTitle'), verify: t('verifyTitle'), codes: t('codesTitle') }[
    step
  ];
  const stepBody = { scan: t('scanBody'), verify: t('verifyBody'), codes: t('codesBody') }[step];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="two-factor-dialog" data-step={step}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('step', { current: index, total: STEPS.length })}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <Alert
            tone="danger"
            data-pattern-state="error"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLoadError(false);
                  setAttempt((n) => n + 1);
                }}
              >
                {t('retry')}
              </Button>
            }
          >
            {t('errors.generic')}
          </Alert>
        ) : !setup ? (
          <SkeletonGroup labels={{ loading: t('preparing') }} data-pattern-state="loading">
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="size-48" />
              <Skeleton className="h-4 w-56" />
            </div>
          </SkeletonGroup>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3
                ref={headingRef}
                tabIndex={-1}
                className="text-base font-semibold outline-none"
                data-slot="two-factor-step-title"
              >
                {stepTitle}
              </h3>
              <p className="text-ink-muted text-sm">{stepBody}</p>
            </div>

            {step === 'scan' ? (
              <div className="flex flex-col items-center gap-3">
                {/* White surface and quiet zone in both themes, so every scanner can read it. A literal: the preset resets `--color-*`, so `bg-white` generates nothing. */}
                <div data-slot="two-factor-qr" className="rounded-lg bg-[#ffffff] p-2 shadow-sm">
                  <img src={setup.qr} alt={t('qrAlt')} width={192} height={192} />
                </div>
                <div className="flex w-full flex-col gap-1">
                  <span id={`${id}-manual`} className="text-ink-muted text-xs">
                    {t('manual')}
                  </span>
                  <code
                    aria-labelledby={`${id}-manual`}
                    data-slot="two-factor-secret"
                    className="bg-surface-sunken rounded px-2 py-1 font-mono text-sm break-all select-all"
                  >
                    {setup.secret}
                  </code>
                </div>
              </div>
            ) : null}

            {step === 'verify' ? (
              <form noValidate id={`${id}-verify`} onSubmit={(event) => void onVerify(event)}>
                <Field label={t('code')} error={codeError}>
                  <Input
                    ref={codeRef}
                    name="code"
                    value={code}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/\D/g, ''));
                      setCodeError(undefined);
                    }}
                  />
                </Field>
              </form>
            ) : null}

            {step === 'codes' ? (
              <div className="flex flex-col gap-3">
                <ul
                  aria-label={t('codesLabel')}
                  data-slot="backup-codes"
                  className="bg-surface-sunken grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg p-3 font-mono text-sm select-all"
                >
                  {setup.backupCodes.map((backupCode) => (
                    <li key={backupCode}>{backupCode}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void onCopy(setup.backupCodes)}
                  >
                    <Copy aria-hidden="true" />
                    {t('copy')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      downloadCodes(setup.backupCodes);
                    }}
                  >
                    <Download aria-hidden="true" />
                    {t('download')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {step === 'scan' ? (
            <Button
              disabled={!setup}
              onClick={() => {
                setStep('verify');
              }}
            >
              {t('next')}
            </Button>
          ) : null}
          {step === 'verify' ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setStep('scan');
                }}
              >
                {t('back')}
              </Button>
              <Button type="submit" form={`${id}-verify`} loading={pending} disabled={!online}>
                {t('verify')}
              </Button>
            </>
          ) : null}
          {step === 'codes' ? (
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('done')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface TwoFactorSetupProps extends TwoFactorActions {
  enabled: boolean;
}

/** The 2FA status row control: `On`, or `Off` with `Set up` and the setup dialog. */
export function TwoFactorSetup({ enabled, enableTwoFactor, verifyTwoFactor }: TwoFactorSetupProps) {
  const t = useTranslations('settings.account.twoFactor');
  const router = useRouter();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(enabled);

  return (
    <div className="flex w-full items-center justify-between gap-2 md:justify-end">
      <Badge tone={on ? 'success' : 'neutral'} data-slot="two-factor-status">
        {on ? t('on') : t('off')}
      </Badge>
      {on ? null : (
        <Button
          variant="secondary"
          size="sm"
          disabled={!online}
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('setUp')}
        </Button>
      )}
      <TwoFactorSetupDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && on) router.refresh();
        }}
        onEnabled={() => {
          setOn(true);
          toast(t('toast.enabled'));
        }}
        enableTwoFactor={enableTwoFactor}
        verifyTwoFactor={verifyTwoFactor}
      />
    </div>
  );
}
