'use client';

// The `?` shortcut sheet (#94): the help sheet opened on its Shortcuts tab, so `?`, the command
// palette and the user menu all reach the one sheet. Only ever loaded with `import()`
// (provider.tsx), on first open, so the Radix dialog stays out of the initial route JS (#11).
import { HelpSheet } from '../../components/help/help-sheet.tsx';
import type { Role } from '../workspace-context.ts';

import type { ShortcutDefinition } from './registry.ts';

export interface ShortcutsHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: readonly ShortcutDefinition[];
  workspaceId: string;
  role?: Role | undefined;
}

/** Every shortcut the user can use, grouped by area, inside the help sheet. */
export function ShortcutsHelpDialog({
  open,
  onOpenChange,
  shortcuts,
  workspaceId,
  role,
}: ShortcutsHelpDialogProps) {
  return (
    <HelpSheet
      open={open}
      onOpenChange={onOpenChange}
      workspaceId={workspaceId}
      role={role}
      initialTab="shortcuts"
      shortcuts={shortcuts}
    />
  );
}
