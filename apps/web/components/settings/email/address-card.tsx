'use client';
// The member's intake address (#54): the full address in a read-only field with Copy, and Rotate
// and Revoke behind a confirmation. Empty state (no address yet): `Create address`. The flag off
// reads `Not enabled yet` and every button is disabled with that reason; offline disables them
// with the offline reason. A rotated or revoked address stops working at once, so both ask first.
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
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { toast } from '@causedeck/ui/sonner';
import { Check, Copy } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { DisabledWithReason, disabledReasonId } from '../disabled-with-reason.tsx';
import { SettingSection } from '../setting-section.tsx';
import { useOnline } from '../settings-offline-banner.tsx';

import type { ActionFn, IntakeAddress } from './types.ts';

export interface AddressCardProps {
  workspaceId: string;
  address: IntakeAddress | null;
  /** The `capture.email-forward` flag. */
  enabled: boolean;
  create: ActionFn<IntakeAddress>;
  rotate: ActionFn<IntakeAddress>;
  revoke: ActionFn<{ addressId: string }>;
}

type Confirming = 'rotate' | 'revoke' | null;

export function AddressCard({
  workspaceId,
  address: initial,
  enabled,
  create,
  rotate,
  revoke,
}: AddressCardProps) {
  const t = useTranslations('emailIntake');
  const format = useFormatter();
  const online = useOnline();
  const [address, setAddress] = useState(initial);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const reason = !enabled ? t('notEnabledReason') : online ? null : t('offlineReason');

  async function run<T>(
    call: () => Promise<Awaited<ReturnType<ActionFn<T>>>>,
    done: (data: T) => void,
    ok: string,
  ) {
    if (!navigator.onLine) {
      toast(t('offlineReason'));
      return;
    }
    setPending(true);
    let result: Awaited<ReturnType<ActionFn<T>>>;
    try {
      result = await call();
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    setConfirming(null);
    if (!result.ok) {
      toast(t(result.error.code === 'FORBIDDEN' ? 'toast.forbidden' : 'toast.error'));
      return;
    }
    done(result.data);
    setCopied(false);
    toast(t(ok));
  }

  const onCreate = () =>
    run(
      () => create({ workspaceId }),
      (data) => {
        setAddress(data);
      },
      'toast.created',
    );
  const onRotate = () =>
    run(
      () => rotate({ workspaceId }),
      (data) => {
        setAddress(data);
      },
      'toast.rotated',
    );
  const onRevoke = () =>
    run(
      () => revoke({ workspaceId, addressId: address?.id }),
      () => {
        setAddress(null);
      },
      'toast.revoked',
    );

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast(t('toast.copyFailed'));
    }
  }

  const guarded = (node: ReactNode) => (
    <DisabledWithReason id="email-address" reason={reason}>
      {node}
    </DisabledWithReason>
  );
  const describedBy = reason === null ? undefined : disabledReasonId('email-address');
  const disabled = reason !== null || pending;

  return (
    <SettingSection
      id="email-address-section"
      data-slot="email-address"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t('address.title')}
          {enabled ? null : (
            <Badge tone="neutral" data-slot="email-not-enabled">
              {t('notEnabled')}
            </Badge>
          )}
        </span>
      }
      description={t('address.description')}
    >
      {address === null ? (
        <div className="flex flex-col gap-3 py-3" data-pattern-state="empty">
          <p className="text-ink-muted text-sm">{t('address.empty')}</p>
          {guarded(
            <Button
              variant="secondary"
              disabled={disabled}
              aria-busy={pending || undefined}
              aria-describedby={describedBy}
              className="w-full md:w-auto"
              onClick={() => {
                void onCreate();
              }}
            >
              {pending ? t('address.creating') : t('address.create')}
            </Button>,
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2 py-3">
          <label htmlFor="email-address-value" className="text-sm font-medium">
            {t('address.label')}
          </label>
          <div className="flex min-w-0 flex-col gap-2 md:flex-row">
            <Input
              id="email-address-value"
              readOnly
              value={address.address}
              data-slot="email-address-value"
              className="min-w-0 flex-1 font-mono"
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <Button
              variant="secondary"
              data-slot="email-address-copy"
              className="w-full md:w-auto"
              onClick={() => {
                void copy(address.address);
              }}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? t('address.copied') : t('address.copy')}
            </Button>
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {copied ? t('address.copied') : ''}
          </p>
          <p className="text-ink-muted text-sm">
            {t('address.createdOn', {
              date: format.dateTime(address.createdAt, { dateStyle: 'medium' }),
            })}
          </p>
          <div className="flex flex-col gap-2 md:flex-row">
            {guarded(
              <Button
                variant="secondary"
                disabled={disabled}
                aria-describedby={describedBy}
                data-slot="email-address-rotate"
                className="w-full md:w-auto"
                onClick={() => {
                  setConfirming('rotate');
                }}
              >
                {t('address.rotate')}
              </Button>,
            )}
            {guarded(
              <Button
                variant="secondary"
                disabled={disabled}
                aria-describedby={describedBy}
                data-slot="email-address-revoke"
                className="w-full md:w-auto"
                onClick={() => {
                  setConfirming('revoke');
                }}
              >
                {t('address.revoke')}
              </Button>,
            )}
          </div>
        </div>
      )}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!pending && !open) setConfirming(null);
        }}
      >
        <AlertDialogContent data-dialog={`${confirming ?? 'rotate'}-intake-address`}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(confirming === 'revoke' ? 'address.revokeTitle' : 'address.rotateTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(confirming === 'revoke' ? 'address.revokeBody' : 'address.rotateBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('address.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!online || pending}
              aria-busy={pending || undefined}
              onClick={(event) => {
                // Keep the dialog open until the call resolves.
                event.preventDefault();
                void (confirming === 'revoke' ? onRevoke() : onRotate());
              }}
            >
              {confirming === 'revoke'
                ? pending
                  ? t('address.revoking')
                  : t('address.revokeConfirm')
                : pending
                  ? t('address.rotating')
                  : t('address.rotateConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingSection>
  );
}
