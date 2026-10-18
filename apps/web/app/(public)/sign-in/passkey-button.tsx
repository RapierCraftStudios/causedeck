'use client';

import { Button } from '@causedeck/ui/button';
import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/** WebAuthn is available in this browser. The server render assumes it is, to avoid a jump. */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function',
    () => true,
  );
}

/** User cancellations and superseded conditional requests are not errors worth showing. */
function isCancelled(error: object): boolean {
  const code = 'code' in error ? error.code : undefined;
  return code === 'AUTH_CANCELLED' || code === 'ERROR_CEREMONY_ABORTED';
}

/**
 * Run a passkey ceremony (`autoFill`: conditional UI in the email field). Navigates to `next` on
 * success; returns whether a real (non-cancelled) failure happened.
 */
async function signInWithPasskey(autoFill: boolean, next: string): Promise<'ok' | 'failed'> {
  const { authClient } = await import('../../../lib/auth-client.ts');
  const result = await authClient.signIn.passkey({ autoFill });
  if (!result.error) {
    window.location.assign(next);
    return 'ok';
  }
  return isCancelled(result.error) ? 'ok' : 'failed';
}

export interface PasskeyButtonProps {
  next: string;
  onError: () => void;
}

/**
 * `Use a passkey`, plus conditional UI: where the browser supports it, saved passkeys are offered
 * in the email field (`autocomplete="username webauthn"`). Disabled, with a reason, when the
 * browser has no WebAuthn.
 */
export function PasskeyButton({ next, onError }: PasskeyButtonProps) {
  const t = useTranslations('auth.signIn');
  const supported = usePasskeySupport();
  const hintId = useId();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const unmounted = new AbortController();
    void (async () => {
      // Older browsers have WebAuthn but not conditional mediation.
      const credential: Partial<typeof PublicKeyCredential> = window.PublicKeyCredential;
      const available = (await credential.isConditionalMediationAvailable?.()) ?? false;
      if (available && !unmounted.signal.aborted) await signInWithPasskey(true, next);
    })().catch(() => {
      // Conditional UI is best effort and silent; the button still works and reports errors.
    });
    return () => {
      unmounted.abort();
    };
  }, [supported, next]);

  async function onClick() {
    setPending(true);
    try {
      if ((await signInWithPasskey(false, next)) === 'failed') onError();
    } catch {
      onError();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="lg"
        loading={pending}
        disabled={!supported}
        aria-describedby={supported ? undefined : hintId}
        onClick={() => void onClick()}
        className="w-full"
        data-testid="passkey-sign-in"
      >
        <KeyRound aria-hidden="true" />
        {t('passkey')}
      </Button>
      {supported ? null : (
        <p id={hintId} className="text-ink-muted text-xs">
          {t('passkeyUnsupported')}
        </p>
      )}
    </div>
  );
}
