import type { Metadata } from 'next';

import { VerifyTwoFactorForm } from './verify-form.tsx';

export const metadata: Metadata = { title: 'Two-factor check' };

export const dynamic = 'force-dynamic';

export default function VerifyTwoFactorPage() {
  return (
    <main id="main" className="mx-auto grid max-w-sm gap-6 px-6 py-24">
      <div className="grid gap-1">
        <p className="text-ink-muted text-xs font-medium tracking-wide uppercase">Staff console</p>
        <h1 className="text-xl font-semibold">Two-factor check</h1>
        <p className="text-ink-muted text-sm">
          Enter the 6-digit code from your authenticator app. Each staff session needs it once.
        </p>
      </div>
      <VerifyTwoFactorForm />
    </main>
  );
}
