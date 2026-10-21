// The topbar strip that tells staff, on every console page, that this is the staff console and
// which environment it is (#309): `--surface-sunken`, a `STAFF CONSOLE` eyebrow, a `STAFF` label
// and the environment tag (staging amber, production red-tinted).
import { Badge, type BadgeTone } from '@causedeck/ui/badge';

import type { AdminEnvLabel } from '../lib/env.ts';
import type { StaffRole } from '../lib/roles.ts';

const ENV_TONE: Record<AdminEnvLabel, BadgeTone> = {
  development: 'neutral',
  staging: 'warning',
  production: 'danger',
};

export function StaffStrip({
  envLabel,
  email,
  role,
}: {
  envLabel: AdminEnvLabel;
  email: string;
  role: StaffRole;
}) {
  return (
    <header
      data-testid="staff-strip"
      className="bg-surface-sunken border-line flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5"
    >
      <span className="text-ink-muted text-xs font-semibold tracking-widest uppercase">
        Staff console
      </span>
      <Badge tone="outline">STAFF</Badge>
      <Badge tone={ENV_TONE[envLabel]} data-testid="env-tag">
        {envLabel}
      </Badge>
      <span className="text-ink-muted ml-auto truncate text-xs">
        {email} · {role}
      </span>
    </header>
  );
}
