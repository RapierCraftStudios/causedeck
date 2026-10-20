// A support session's state as a status chip (#314).
import { Badge, type BadgeTone } from '@causedeck/ui/badge';
import type { SupportSessionState } from '@causedeck/core/support';

const CHIP: Record<SupportSessionState, { label: string; tone: BadgeTone }> = {
  requested: { label: 'Pending', tone: 'warning' },
  active: { label: 'Active', tone: 'danger' },
  denied: { label: 'Denied', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  ended: { label: 'Ended', tone: 'neutral' },
};

export function SessionStateChip({ state }: { state: SupportSessionState }) {
  const chip = CHIP[state];
  return (
    <Badge tone={chip.tone} data-slot="support-session-state" data-state={state}>
      {chip.label}
    </Badge>
  );
}
