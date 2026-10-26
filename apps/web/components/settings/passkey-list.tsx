'use client';
// The account passkey list (#289, #25 design spec). `Add passkey` runs the WebAuthn registration
// ceremony in the browser (Better Auth's passkey client; the server hook audits it), then refreshes
// the server-rendered list. `Remove` asks for confirmation and calls `deletePasskeyAction`, which
// only removes one of the caller's own passkeys. Empty: `No passkeys yet. Add one to sign in with
// your fingerprint or screen lock.` Offline, both actions are disabled.
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
import { Button } from '@causedeck/ui/button';
import { toast } from '@causedeck/ui/sonner';
import { KeyRound, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { useOnline } from './settings-offline-banner.tsx';

export interface PasskeyView {
  id: string;
  name: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface PasskeyListProps {
  passkeys: readonly PasskeyView[];
  deletePasskey: (input: { id: string }) => Promise<Result<{ id: string }>>;
  /** Defaults to Better Auth's passkey client (loaded on first use). */
  addPasskey?: () => Promise<'added' | 'cancelled' | 'failed'>;
}

const noopSubscribe = () => () => {};

function usePasskeySupport(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof window.PublicKeyCredential === 'function',
    () => true,
  );
}

async function registerPasskey(): Promise<'added' | 'cancelled' | 'failed'> {
  const { authClient } = await import('../../lib/auth-client.ts');
  const result = await authClient.passkey.addPasskey();
  if (!result.error) return 'added';
  const code = 'code' in result.error ? result.error.code : undefined;
  return code === 'AUTH_CANCELLED' || code === 'ERROR_CEREMONY_ABORTED' ? 'cancelled' : 'failed';
}

export function PasskeyList({
  passkeys,
  deletePasskey,
  addPasskey = registerPasskey,
}: PasskeyListProps) {
  const t = useTranslations('settings.account');
  const format = useFormatter();
  const router = useRouter();
  const online = useOnline();
  const supported = usePasskeySupport();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PasskeyView | null>(null);
  const [pending, setPending] = useState(false);

  const label = (passkey: PasskeyView) => passkey.name ?? t('passkeys.unnamed');

  async function onAdd() {
    setAdding(true);
    try {
      const outcome = await addPasskey();
      if (outcome === 'added') {
        toast(t('passkeys.toast.added'));
        router.refresh();
      } else if (outcome === 'failed') {
        toast(t('passkeys.toast.addFailed'));
      }
    } catch {
      toast(t('passkeys.toast.addFailed'));
    } finally {
      setAdding(false);
    }
  }

  async function onRemove(passkey: PasskeyView) {
    setPending(true);
    let result: Result<{ id: string }>;
    try {
      result = await deletePasskey({ id: passkey.id });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    setRemoving(null);
    if (result.ok) {
      toast(t('passkeys.toast.removed'));
      router.refresh();
    } else {
      toast(result.error.code === 'FORBIDDEN' ? t('forbidden') : t('passkeys.toast.removeFailed'));
    }
  }

  return (
    <div data-slot="passkey-list" className="flex flex-col gap-3 py-3">
      {passkeys.length === 0 ? (
        <p data-pattern-state="empty" className="text-ink-muted text-sm">
          {t('passkeys.empty')}
        </p>
      ) : (
        <ul aria-label={t('passkeys.listLabel')} className="divide-line flex flex-col divide-y">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              data-passkey={passkey.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <KeyRound aria-hidden="true" className="text-ink-muted size-4 shrink-0" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{label(passkey)}</span>
                  <span className="text-ink-muted text-xs">
                    {t('passkeys.added', {
                      date: format.dateTime(new Date(passkey.createdAt), { dateStyle: 'medium' }),
                    })}
                  </span>
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!online || pending}
                aria-label={t('passkeys.removeLabel', { name: label(passkey) })}
                onClick={() => {
                  setRemoving(passkey);
                }}
              >
                {t('passkeys.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col items-start gap-1">
        <Button
          variant="secondary"
          size="sm"
          loading={adding}
          disabled={!online || !supported}
          onClick={() => void onAdd()}
        >
          <Plus aria-hidden="true" />
          {t('passkeys.add')}
        </Button>
        {supported ? null : <p className="text-ink-muted text-xs">{t('passkeys.unsupported')}</p>}
      </div>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent data-slot="remove-passkey-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('passkeys.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('passkeys.removeBody', { name: removing ? label(removing) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending || !online}
              onClick={(event) => {
                event.preventDefault();
                if (removing) void onRemove(removing);
              }}
            >
              {t('passkeys.removeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
