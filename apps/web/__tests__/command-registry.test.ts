import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@causedeck/i18n/messages/en.json';
import {
  navigationCommands,
  registerNavigationCommands,
} from '../lib/commands/navigation-commands.ts';
import { RECENT_LIMIT, pushRecent, readRecent, recentKey } from '../lib/commands/recent.ts';
import {
  commandSourcesSnapshot,
  commandsSnapshot,
  getCommandSources,
  getCommands,
  registerCommandSource,
  registerCommands,
  resetCommands,
  subscribeCommands,
} from '../lib/commands/registry.ts';
import { COMMAND_GROUPS, type CommandSource } from '../lib/commands/types.ts';
import { NAV_ITEMS } from '../lib/nav.ts';

const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);
const noop = () => undefined;

afterEach(() => {
  resetCommands();
});

describe('command registry', () => {
  it('declares the Go to, Create, Matters, Settings and Help groups in that order', () => {
    expect([...COMMAND_GROUPS]).toEqual(['goTo', 'create', 'matters', 'settings', 'help']);
    for (const group of COMMAND_GROUPS) expect(en.palette.groups[group]).toBeTruthy();
    expect(Object.values(en.palette.groups)).toEqual([
      'Go to',
      'Create',
      'Matters',
      'Settings',
      'Help',
    ]);
  });

  it('accepts commands registered by other modules, in group then registration order', () => {
    registerCommands('help', [{ id: 'help.shortcuts', labelKey: 'x', perform: noop }]);
    registerCommands('create', [
      { id: 'create.matter', labelKey: 'x', perform: noop },
      { id: 'create.note', labelKey: 'x', perform: noop },
    ]);
    registerNavigationCommands();
    const visible = getCommands({ role: 'owner' });
    expect(ids(visible).slice(0, 3)).toEqual(['go.today', 'go.tomorrow', 'go.calendar']);
    expect(ids(visible).slice(-4)).toEqual([
      'create.matter',
      'create.note',
      'go.settings',
      'help.shortcuts',
    ]);
    expect(visible.find((entry) => entry.id === 'create.note')?.group).toBe('create');
  });

  it('unregisters exactly the items it added', () => {
    registerCommands('create', [{ id: 'a', labelKey: 'x', perform: noop }]);
    const remove = registerCommands('create', [{ id: 'b', labelKey: 'x', perform: noop }]);
    remove();
    expect(ids(commandsSnapshot())).toEqual(['a']);
  });

  it('replaces a command registered again under the same id', () => {
    registerCommands('create', [{ id: 'a', labelKey: 'old', perform: noop }]);
    registerCommands('help', [{ id: 'a', labelKey: 'new', perform: noop }]);
    expect(commandsSnapshot()).toHaveLength(1);
    expect(commandsSnapshot()[0]).toMatchObject({ labelKey: 'new', group: 'help' });
  });

  it('hides commands behind an off flag or a permission the role lacks', () => {
    registerNavigationCommands();
    const owner = ids(getCommands({ role: 'owner' }));
    expect(owner).toContain('go.billing');
    expect(owner).not.toContain('go.invoices');
    expect(ids(getCommands({ role: 'viewer' }))).not.toContain('go.billing');
    expect(ids(getCommands({ role: 'owner', isEnabled: () => true }))).toContain('go.invoices');
  });

  it('notifies subscribers and keeps a stable snapshot between changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommands(listener);
    const before = commandsSnapshot();
    expect(commandsSnapshot()).toBe(before);
    registerCommands('create', [{ id: 'a', labelKey: 'x', perform: noop }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(commandsSnapshot()).not.toBe(before);
    unsubscribe();
    registerCommands('create', [{ id: 'b', labelKey: 'x', perform: noop }]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('command sources (#388)', () => {
  const source = (id: string, extra: Partial<CommandSource> = {}): CommandSource => ({
    id,
    group: 'matters',
    search: () => Promise.resolve([]),
    ...extra,
  });

  it('adds sources in order, replaces one by id and removes exactly the one registered', () => {
    registerCommandSource(source('a'));
    const remove = registerCommandSource(source('b'));
    expect(ids(commandSourcesSnapshot())).toEqual(['a', 'b']);
    const replaced = source('a', { minQuery: 3 });
    registerCommandSource(replaced);
    expect(ids(commandSourcesSnapshot())).toEqual(['b', 'a']);
    expect(commandSourcesSnapshot()[1]).toBe(replaced);
    remove();
    expect(ids(commandSourcesSnapshot())).toEqual(['a']);
  });

  it('hides sources the role may not use or whose flag is off', () => {
    registerCommandSource(source('open'));
    registerCommandSource(source('readers', { requires: 'matter.read' }));
    registerCommandSource(source('writers', { requires: 'matter.write' }));
    registerCommandSource(source('flagged', { flag: 'matters_ui' as never }));
    expect(ids(getCommandSources({ role: 'viewer' }))).toEqual(['open', 'readers']);
    expect(ids(getCommandSources({ role: 'owner' }))).toEqual(['open', 'readers', 'writers']);
    expect(ids(getCommandSources({ role: 'owner', isEnabled: () => true }))).toEqual([
      'open',
      'readers',
      'writers',
      'flagged',
    ]);
  });

  it('notifies subscribers, and reset clears sources as well as commands', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommands(listener);
    registerCommandSource(source('a'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    registerCommands('create', [{ id: 'c', labelKey: 'x', perform: noop }]);
    resetCommands();
    expect(commandSourcesSnapshot()).toEqual([]);
    expect(commandsSnapshot()).toEqual([]);
  });

  it('keeps literal labels on search results apart from message keys', () => {
    registerCommands('matters', [{ id: 'matter.1', label: 'Rao v. State', perform: noop }]);
    expect(commandsSnapshot()[0]).toMatchObject({ label: 'Rao v. State', group: 'matters' });
    expect(commandsSnapshot()[0]?.labelKey).toBeUndefined();
  });
});

describe('navigation commands', () => {
  it('cover every nav destination, settings under Settings, navigating to the item href', () => {
    const commands = navigationCommands();
    expect(ids(commands)).toEqual(NAV_ITEMS.map((item) => `go.${item.id}`));
    for (const command of commands) {
      const item = NAV_ITEMS.find((entry) => `go.${entry.id}` === command.id);
      expect(command.group).toBe(item?.id === 'settings' ? 'settings' : 'goTo');
      expect(command.labelKey).toBe(item?.labelKey);
      const navigate = vi.fn();
      void command.perform({ slug: 'demo', workspaceId: 'ws-1', navigate, close: noop });
      expect(navigate).toHaveBeenCalledWith(item?.href('demo'));
    }
  });

  it('register once', () => {
    registerNavigationCommands();
    registerNavigationCommands();
    expect(commandsSnapshot()).toHaveLength(NAV_ITEMS.length);
  });
});

describe('recent commands', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the most recent first, deduplicated, capped and per workspace', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) pushRecent('demo', id);
    expect(readRecent('demo')).toEqual(['b', 'f', 'e', 'd', 'c']);
    expect(readRecent('demo')).toHaveLength(RECENT_LIMIT);
    expect(readRecent('other')).toEqual([]);
  });

  it('survives corrupt or unavailable storage', () => {
    store.set(recentKey('demo'), '{not json');
    expect(readRecent('demo')).toEqual([]);
    store.set(recentKey('demo'), '{"a":1}');
    expect(readRecent('demo')).toEqual([]);
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('blocked');
      },
    });
    expect(readRecent('demo')).toEqual([]);
    expect(pushRecent('demo', 'a')).toEqual(['a']);
  });
});
