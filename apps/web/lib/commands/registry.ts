// The command registry. Any module registers commands; the palette subscribes and re-renders.
import { flagsOff } from '../nav.ts';
import { can, type FlagKey, type Role } from '../workspace-context.ts';

import {
  COMMAND_GROUPS,
  type Command,
  type CommandGroupId,
  type CommandInput,
  type CommandSource,
} from './types.ts';

let commands: readonly Command[] = [];
let sources: readonly CommandSource[] = [];
const listeners = new Set<() => void>();

function commit(next: readonly Command[], nextSources: readonly CommandSource[] = sources) {
  commands = next;
  sources = nextSources;
  for (const notify of listeners) notify();
}

/**
 * Add `items` to `group` (an item whose id is already registered replaces it). Returns a function
 * that removes exactly these items again.
 */
export function registerCommands(
  group: CommandGroupId,
  items: readonly CommandInput[],
): () => void {
  const added = items.map((entry): Command => ({ ...entry, group }));
  const ids = new Set(added.map((entry) => entry.id));
  commit([...commands.filter((entry) => !ids.has(entry.id)), ...added]);
  return () => {
    commit(commands.filter((entry) => !added.includes(entry)));
  };
}

export function subscribeCommands(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every registered command, in registration order. Stable between changes. */
export function commandsSnapshot(): readonly Command[] {
  return commands;
}

export interface GetCommandsOptions {
  /** When given, commands the role lacks permission for are hidden. */
  role?: Role | undefined;
  isEnabled?: ((flag: FlagKey) => boolean) | undefined;
}

/** Visible commands in group order, then registration order. */
export function getCommands(
  { role, isEnabled = flagsOff }: GetCommandsOptions = {},
  source: readonly Command[] = commands,
): Command[] {
  return COMMAND_GROUPS.flatMap((group) =>
    source.filter(
      (entry) =>
        entry.group === group &&
        (entry.flag === undefined || isEnabled(entry.flag)) &&
        (role === undefined || entry.requires === undefined || can(role, entry.requires)),
    ),
  );
}

/**
 * Add a search-backed source (a source whose id is already registered replaces it). Returns a
 * function that removes exactly this source again.
 */
export function registerCommandSource(source: CommandSource): () => void {
  commit(commands, [...sources.filter((entry) => entry.id !== source.id), source]);
  return () => {
    commit(
      commands,
      sources.filter((entry) => entry !== source),
    );
  };
}

/** Sources change through the same listeners as commands. */
export function subscribeCommandSources(listener: () => void): () => void {
  return subscribeCommands(listener);
}

/** Every registered source, in registration order. Stable between changes. */
export function commandSourcesSnapshot(): readonly CommandSource[] {
  return sources;
}

/** Sources visible to the role with the flags on, as `getCommands` filters commands. */
export function getCommandSources(
  { role, isEnabled = flagsOff }: GetCommandsOptions = {},
  source: readonly CommandSource[] = sources,
): CommandSource[] {
  return source.filter(
    (entry) =>
      (entry.flag === undefined || isEnabled(entry.flag)) &&
      (role === undefined || entry.requires === undefined || can(role, entry.requires)),
  );
}

/** Tests only: empty the registry (commands and sources). */
export function resetCommands(): void {
  commit([], []);
}
