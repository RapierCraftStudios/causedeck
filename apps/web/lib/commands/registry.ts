// The command registry. Any module registers commands; the palette subscribes and re-renders.
import { flagsOff } from '../nav.ts';
import { can, type FlagKey, type Role } from '../workspace-context.ts';

import { COMMAND_GROUPS, type Command, type CommandGroupId } from './types.ts';

let commands: readonly Command[] = [];
const listeners = new Set<() => void>();

function commit(next: readonly Command[]) {
  commands = next;
  for (const notify of listeners) notify();
}

/**
 * Add `items` to `group` (an item whose id is already registered replaces it). Returns a function
 * that removes exactly these items again.
 */
export function registerCommands(
  group: CommandGroupId,
  items: readonly Omit<Command, 'group'>[],
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

/** Tests only: empty the registry. */
export function resetCommands(): void {
  commit([]);
}
