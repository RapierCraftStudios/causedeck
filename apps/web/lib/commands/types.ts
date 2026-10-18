// The command palette's command model (#11 data contract). Features add commands to the palette
// with `registerCommands(group, items)` from registry.ts.
import type { LucideIcon } from 'lucide-react';

import type { FlagKey, Permission } from '../workspace-context.ts';

/** Palette groups, in display order. Headings are `palette.groups.<id>`. */
export const COMMAND_GROUPS = ['goTo', 'create', 'matters', 'settings', 'help'] as const;

export type CommandGroupId = (typeof COMMAND_GROUPS)[number];

/** What a command can do when it runs. */
export interface CommandContext {
  /** Current workspace slug. */
  slug: string;
  navigate: (href: string) => void;
  /** Close the palette. */
  close: () => void;
}

export interface Command {
  /** Unique across the registry; also the key for recent items. */
  id: string;
  /** Message key for the label, from the root of the catalog (e.g. `nav.today`). */
  labelKey: string;
  group: CommandGroupId;
  /** Extra search terms. */
  keywords?: readonly string[];
  /** Hotkey shown on the row, e.g. `g t`. */
  shortcut?: string;
  icon?: LucideIcon;
  perform: (ctx: CommandContext) => void | Promise<void>;
  requires?: Permission;
  flag?: FlagKey;
}
