'use client';

// Client half of SurfaceHelp (#94): the contextual tip and the coachmark load after the page
// renders (`ssr: false`), so they add nothing to a surface's initial JS (workspace shell budget).
import dynamic from 'next/dynamic';

import type { HelpSurface } from '../../lib/help/surfaces.ts';
import type { Role } from '../../lib/workspace-context.ts';

const ContextualTip = dynamic(() => import('./contextual-tip.tsx').then((m) => m.ContextualTip), {
  ssr: false,
});
const Coachmark = dynamic(() => import('./contextual-tip.tsx').then((m) => m.Coachmark), {
  ssr: false,
});

export interface SurfaceHelpClientProps {
  surface: Exclude<HelpSurface, 'general'>;
  workspaceId: string;
  role: Role;
  dismissed: boolean;
}

export function SurfaceHelpClient({
  surface,
  workspaceId,
  role,
  dismissed,
}: SurfaceHelpClientProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <ContextualTip surface={surface} workspaceId={workspaceId} role={role} />
      </div>
      <Coachmark surface={surface} workspaceId={workspaceId} dismissed={dismissed} />
    </div>
  );
}
