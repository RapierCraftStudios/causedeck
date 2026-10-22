// The command palette's command model (#11 data contract). Features add commands to the palette
// with `registerCommands(group, items)` from registry.ts, and results that come from a search (a
// matter by its case number, #388) with `registerCommandSource(source)`.
import type { LucideIcon } from 'lucide-react';

import type { FlagKey, Permission } from '../workspace-context.ts';

/** Palette groups, in display order. Headings are `palette.groups.<id>`. */
export const COMMAND_GROUPS = ['goTo', 'create', 'matters', 'settings', 'help'] as const;

export type CommandGroupId = (typeof COMMAND_GROUPS)[number];

/** What a command can do when it runs. */
export interface CommandContext {
  /** Current workspace slug. */
  slug: string;
  /** Current workspace id (server actions name the workspace they act on). */
  workspaceId: string;
  navigate: (href: string) => void;
  /** Close the palette. */
  close: () => void;
}

interface CommandBase {
  /** Unique across the registry; also the key for recent items. */
  id: string;
  group: CommandGroupId;
  /** A muted second line, e.g. a matter's forum and next date. */
  detail?: string;
  /** Extra search terms. */
  keywords?: readonly string[];
  /** Hotkey shown on the row, in `useHotkey` syntax: `c`, `mod+k`, `g then t`. */
  shortcut?: string;
  icon?: LucideIcon;
  perform: (ctx: CommandContext) => void | Promise<void>;
  requires?: Permission;
  flag?: FlagKey;
}

/** A command names its label by message key, or (search results) carries the text itself. */
export type Command = CommandBase &
  (
    | {
        /** Message key for the label, from the root of the catalog (e.g. `nav.today`). */
        labelKey: string;
        label?: undefined;
      }
    | {
        /** Literal label, already user content (a matter title); shown as is. */
        label: string;
        labelKey?: undefined;
      }
  );

/** `Omit` that keeps the label union apart. */
export type CommandInput = Command extends infer C
  ? C extends unknown
    ? Omit<C, 'group'>
    : never
  : never;

/** What a command source is given for one search. */
export interface CommandSourceContext {
  slug: string;
  workspaceId: string;
}

/**
 * Commands found by a search rather than registered up front: the palette asks each visible
 * source once the query is `minQuery` characters long and shows its results in `group`.
 */
export interface CommandSource {
  id: string;
  group: CommandGroupId;
  requires?: Permission;
  flag?: FlagKey;
  /** Shortest query (after trimming) the source is asked for; 1 when omitted. */
  minQuery?: number;
  search: (query: string, ctx: CommandSourceContext) => Promise<CommandInput[]>;
}
