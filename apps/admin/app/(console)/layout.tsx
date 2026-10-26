// The staff console shell (#309). proxy.ts has already gated the request; `requireStaff()` checks
// the session and the staff_user row again here, so a misconfigured matcher still shows nothing.
import type { ReactNode } from 'react';

import { ConsoleNav } from '../../components/console-nav.tsx';
import { StaffStrip } from '../../components/staff-strip.tsx';
import { adminEnvLabel, serverEnv } from '../../lib/env.ts';
import { requireStaff } from '../../lib/staff.ts';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  return (
    <div className="flex min-h-dvh flex-col">
      <StaffStrip envLabel={adminEnvLabel(serverEnv())} email={staff.email} role={staff.role} />
      <div className="flex flex-1 flex-col md:flex-row">
        <ConsoleNav role={staff.role} />
        <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
