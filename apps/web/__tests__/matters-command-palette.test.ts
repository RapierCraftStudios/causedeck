// @vitest-environment jsdom
// The matters entries of the command palette (#388): `New matter` (create group, `n`, writers
// only) and the matter search source. Typing a case number in any punctuation, a party or a title
// asks `searchMattersAction` 150 ms after typing stops; hits show under the Matters heading with
// their forum and next date and open the matter. A stale answer never replaces a newer one, a role
// without `matter.read` never asks, and search hits are not kept as recent items.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette, SOURCE_DEBOUNCE_MS } from '../components/shell/command-palette.tsx';
import { readRecent } from '../lib/commands/recent.ts';
import {
  commandSourcesSnapshot,
  commandsSnapshot,
  registerCommandSource,
  resetCommands,
} from '../lib/commands/registry.ts';
import type { CommandInput } from '../lib/commands/types.ts';
import {
  MATTER_SEARCH_SOURCE_ID,
  registerMatterCommands,
  searchMatterCommands,
} from '../lib/matters/command-palette.ts';
import type { Role } from '../lib/workspace-context.ts';

import { catalogs } from './helpers/intl.ts';

const searchMattersAction = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock('../app/(app)/w/[slug]/matters/actions.ts', () => ({
  searchMattersAction,
  createMatterAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@causedeck/flags/react', () => ({ useIsEnabled: () => () => false }));

// cmdk measures its list and scrolls items into view; jsdom has neither.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const hit = (id: string, title: string, forum: string | null, text: string | null) => ({
  id,
  title,
  forum,
  nextDate: text === null ? null : { date: '2026-11-14', confirmationState: 'confirmed', text },
  noNextDateText: 'No next date',
  sensitive: false,
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollIntoView = vi.fn();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => {
      store.clear();
    },
  });
});

afterEach(() => {
  cleanup();
  resetCommands();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('matter palette commands (#388)', () => {
  it('registers New matter for writers and the matter search source, once', () => {
    registerMatterCommands();
    registerMatterCommands();
    const created = commandsSnapshot().filter((entry) => entry.id === 'create.matter');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      group: 'create',
      labelKey: 'matters.palette.new',
      shortcut: 'n',
      requires: 'matter.write',
    });
    const navigate = vi.fn();
    void created[0]?.perform({ slug: 'demo', workspaceId: 'ws-1', navigate, close: vi.fn() });
    expect(navigate).toHaveBeenCalledWith('/w/demo/matters?new=1');
    expect(commandSourcesSnapshot()).toEqual([
      expect.objectContaining({
        id: MATTER_SEARCH_SOURCE_ID,
        group: 'matters',
        requires: 'matter.read',
        minQuery: 2,
      }),
    ]);
  });

  it('maps hits to commands with the forum and next date, opening the matter', async () => {
    searchMattersAction.mockResolvedValue({
      ok: true,
      data: [
        hit('m1', 'Rao v. State', 'Madras High Court', 'Sat, 14 Nov 2026'),
        hit('m2', 'Unlisted v. Nobody', null, null),
      ],
    });
    const found = await searchMatterCommands('wp 45/26', { slug: 'demo', workspaceId: 'ws-1' });
    expect(searchMattersAction).toHaveBeenCalledWith({ workspaceId: 'ws-1', q: 'wp 45/26' });
    expect(found.map(({ id, label, detail }) => ({ id, label, detail }))).toEqual([
      { id: 'matter.m1', label: 'Rao v. State', detail: 'Madras High Court · Sat, 14 Nov 2026' },
      { id: 'matter.m2', label: 'Unlisted v. Nobody', detail: 'No next date' },
    ]);
    const navigate = vi.fn();
    void found[0]?.perform({ slug: 'demo', workspaceId: 'ws-1', navigate, close: vi.fn() });
    expect(navigate).toHaveBeenCalledWith('/w/demo/matters/m1');
  });

  it('finds nothing when the action fails or refuses', async () => {
    searchMattersAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'FORBIDDEN', message: '' },
    });
    expect(await searchMatterCommands('rao', { slug: 'demo', workspaceId: 'ws-1' })).toEqual([]);
    searchMattersAction.mockRejectedValueOnce(new Error('network'));
    expect(await searchMatterCommands('rao', { slug: 'demo', workspaceId: 'ws-1' })).toEqual([]);
  });
});

function palette(role: Role = 'owner') {
  return render(
    createElement(NextIntlClientProvider, {
      locale: 'en',
      messages: catalogs.en,
      timeZone: 'Asia/Kolkata',
      children: createElement(CommandPalette, {
        open: true,
        onOpenChange: vi.fn(),
        slug: 'demo',
        workspaceId: 'ws-1',
        role,
      }),
    }),
  );
}

async function type(value: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SOURCE_DEBOUNCE_MS);
  });
}

describe('command palette with the matter source (#388)', () => {
  it('shows hits under Matters after the debounce, with their detail, and opens one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchMattersAction.mockResolvedValue({
      ok: true,
      data: [hit('m1', 'Rao v. State', 'Madras High Court', 'Sat, 14 Nov 2026')],
    });
    registerMatterCommands();
    palette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'W.P. 45/2026' } });
    expect(searchMattersAction).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SOURCE_DEBOUNCE_MS);
    });
    expect(searchMattersAction).toHaveBeenCalledWith({ workspaceId: 'ws-1', q: 'W.P. 45/2026' });
    const group = document.querySelector('[data-palette-group="matters"]');
    expect(group?.textContent).toContain(catalogs.en.palette.groups.matters);
    expect(group?.textContent).toContain('Rao v. State');
    expect(group?.querySelector('[data-palette-detail]')?.textContent).toBe(
      'Madras High Court · Sat, 14 Nov 2026',
    );
    fireEvent.click(screen.getByRole('option', { name: /Rao v\. State/ }));
    expect(router.push).toHaveBeenCalledWith('/w/demo/matters/m1');
    expect(readRecent('demo')).not.toContain('matter.m1');
  });

  it('never asks below two characters, or for a role without matter.read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn((): Promise<CommandInput[]> => Promise.resolve([]));
    registerCommandSource({
      id: 'probe',
      group: 'matters',
      requires: 'billing.manage',
      minQuery: 2,
      search,
    });
    palette('viewer');
    await type('rao');
    expect(search).not.toHaveBeenCalled();
    cleanup();
    palette('owner');
    await type('r');
    expect(search).not.toHaveBeenCalled();
    await type('ra');
    expect(search).toHaveBeenCalledWith('ra', { slug: 'demo', workspaceId: 'ws-1' });
  });

  it('drops an answer that arrives after a newer query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let releaseFirst: (items: CommandInput[]) => void = () => undefined;
    const search = vi.fn((query: string): Promise<CommandInput[]> => {
      if (query === 'old') {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve([{ id: 'new', label: 'Newer matter', perform: vi.fn() }]);
    });
    registerCommandSource({ id: 'probe', group: 'matters', search });
    palette();
    await type('old');
    await type('newer');
    await act(async () => {
      releaseFirst([{ id: 'old', label: 'Stale matter', perform: vi.fn() }]);
      await vi.advanceTimersByTimeAsync(0);
    });
    const group = document.querySelector('[data-palette-group="matters"]');
    expect(group?.textContent).toContain('Newer matter');
    expect(document.body.textContent).not.toContain('Stale matter');
  });
});
