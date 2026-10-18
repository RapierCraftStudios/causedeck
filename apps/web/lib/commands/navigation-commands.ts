// `Go to` commands for every destination in the nav manifest (settings sits under `Settings`), with
// their `g` chord as the hint.
import { NAV_ITEMS } from '../nav.ts';
import { chordHint } from '../shortcuts/registry.ts';

import { commandsSnapshot, registerCommands } from './registry.ts';
import type { Command } from './types.ts';

export function navigationCommands(): Command[] {
  return NAV_ITEMS.map((item): Command => {
    const shortcut = chordHint(item.id);
    return {
      id: `go.${item.id}`,
      labelKey: item.labelKey,
      group: item.id === 'settings' ? 'settings' : 'goTo',
      icon: item.icon,
      ...(shortcut === undefined ? {} : { shortcut }),
      ...(item.requires === undefined ? {} : { requires: item.requires }),
      ...(item.flag === undefined ? {} : { flag: item.flag }),
      perform: (ctx) => {
        ctx.navigate(item.href(ctx.slug));
      },
    };
  });
}

/** Register the navigation commands unless they already are. */
export function registerNavigationCommands(): void {
  if (commandsSnapshot().some((entry) => entry.id === 'go.today')) return;
  const all = navigationCommands();
  registerCommands(
    'goTo',
    all.filter((entry) => entry.group === 'goTo'),
  );
  registerCommands(
    'settings',
    all.filter((entry) => entry.group === 'settings'),
  );
}
