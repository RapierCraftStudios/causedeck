'use client';
// The Forward lane of the import step (#92): the workspace-specific forwarding address in a copy
// field. The address is unguessable and revocable; it is created on request, and while email
// forwarding is not switched on for the workspace (the `capture.email-forward` flag) or its
// transport has no credentials yet, the lane says so and the other two lanes carry on. It never
// blocks the wizard.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Result } from '../../lib/safe-action.ts';

export interface ForwardingAddress {
  id: string;
  address: string;
}

export interface ForwardInstructionsProps {
  /** The address that already exists, if any. */
  initial: ForwardingAddress | null;
  /** Forwarding is switched on for this workspace; false shows the unavailable note. */
  available: boolean;
  create: () => Promise<Result<ForwardingAddress>>;
  revoke: (addressId: string) => Promise<Result<unknown>>;
  disabled?: boolean;
}

export function ForwardInstructions({
  initial,
  available,
  create,
  revoke,
  disabled = false,
}: ForwardInstructionsProps) {
  const t = useTranslations('onboarding.import.lanes.forward');
  const nav = useTranslations('onboarding.import');
  const [address, setAddress] = useState(initial);
  const [revoked, setRevoked] = useState(false);
  const [unavailable, setUnavailable] = useState(!available);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    setBusy(true);
    setFailed(false);
    try {
      const result = await create();
      if (result.ok) {
        setAddress(result.data);
        setRevoked(false);
      } else if (result.error.code === 'NOT_FOUND') setUnavailable(true);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  async function onRevoke() {
    if (address === null) return;
    setBusy(true);
    try {
      const result = await revoke(address.id);
      if (result.ok) {
        setAddress(null);
        setRevoked(true);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  async function onCopy() {
    if (address === null) return;
    try {
      await navigator.clipboard.writeText(address.address);
      setCopied(true);
    } catch {
      // Clipboard blocked: the address is still selectable in the field.
    }
  }

  return (
    <div data-lane="forward" className="flex flex-col gap-3">
      <p className="text-ink-muted text-sm">{t('body')}</p>
      {unavailable ? (
        <Alert tone="info">{t('unavailable')}</Alert>
      ) : address === null ? (
        <>
          {revoked ? <p className="text-ink-muted text-sm">{t('revoked')}</p> : null}
          <Button
            type="button"
            variant="outline"
            size="lg"
            loading={busy}
            labels={{ loading: t('create') }}
            disabled={disabled}
            onClick={() => void onCreate()}
          >
            {t('create')}
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="forward-address" className="text-sm font-medium">
            {t('addressLabel')}
          </label>
          <div className="flex gap-2">
            <Input
              id="forward-address"
              readOnly
              value={address.address}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              className="h-11 font-mono"
            />
            <Button type="button" variant="outline" size="lg" onClick={() => void onCopy()}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              <span role="status">{copied ? t('copied') : t('copy')}</span>
            </Button>
          </div>
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={busy || disabled}
            onClick={() => void onRevoke()}
          >
            {t('revoke')}
          </Button>
        </div>
      )}
      {failed ? <Alert tone="danger">{nav('forwardFailed')}</Alert> : null}
    </div>
  );
}
