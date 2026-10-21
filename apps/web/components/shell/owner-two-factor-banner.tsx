// Owner 2FA banner (#290, lib/require-2fa-for-owners.ts): once an owner's 7-day grace without
// two-factor authentication has run out, every workspace page shows this above the content until
// 2FA is on. It is not dismissible; the server refuses delete, export and billing meanwhile. No
// client JS: the state is decided by the workspace layout on the server.
import { Alert } from '@causedeck/ui/alert';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { OwnerTwoFactorState } from '../../lib/require-2fa-for-owners.ts';

/** The account page's two-factor section. */
export const TWO_FACTOR_SETUP_HREF = '/account#two-factor';

export function OwnerTwoFactorBanner({ state }: { state: OwnerTwoFactorState }) {
  const t = useTranslations('shell.ownerTwoFactor');
  if (state !== 'required') return null;
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 md:px-6">
      <Alert
        tone="warning"
        icon={<ShieldAlert />}
        data-slot="owner-two-factor-banner"
        className="break-words"
        action={
          <Link
            href={TWO_FACTOR_SETUP_HREF}
            className="text-accent text-sm font-medium underline-offset-2 hover:underline"
          >
            {t('action')}
          </Link>
        }
      >
        {t('message')}
      </Alert>
    </div>
  );
}
