'use client';
// The brief sheet's right-rail slot for what changed on the matter since the viewer last opened it
// (#71). Opening the brief records the view; the first-ever view shows no card. Hidden in print.
import { WhatChangedCard } from '../../../matters/[id]/_continuity/what-changed-card.tsx';

export function WhatChangedRail({
  workspaceId,
  matterId,
  members,
}: {
  workspaceId: string;
  matterId: string;
  members: Record<string, string>;
}) {
  return (
    <aside className="print:hidden" data-slot="what-changed-rail">
      <WhatChangedCard workspaceId={workspaceId} matterId={matterId} members={members} />
    </aside>
  );
}
