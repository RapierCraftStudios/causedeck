import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@causedeck/i18n/messages/en.json';
import {
  navigationCommands,
  registerNavigationCommands,
} from '../lib/commands/navigation-commands.ts';
import { RECENT_LIMIT, pushRecent, readRecent, recentKey } from '../lib/commands/recent.ts';
import {
  commandsSnapshot,
  getCommands,
  registerCommands,
  resetCommands,
  subscribeCommands,
} from '../lib/commands/registry.ts';
import { COMMAND_GROUPS } from '../lib/commands/types.ts';
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

describe('navigation commands', () => {
  it('cover every nav destination, settings under Settings, navigating to the item href', () => {
    const commands = navigationCommands();
    expect(ids(commands)).toEqual(NAV_ITEMS.map((item) => `go.${item.id}`));
    for (const command of commands) {
      const item = NAV_ITEMS.find((entry) => `go.${entry.id}` === command.id);
      expect(command.group).toBe(item?.id === 'settings' ? 'settings' : 'goTo');
      expect(command.labelKey).toBe(item?.labelKey);
      const navigate = vi.fn();
      void command.perform({ slug: 'demo', navigate, close: noop });
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
